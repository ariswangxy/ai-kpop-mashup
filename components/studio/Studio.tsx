"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Sparkles } from "lucide-react";
import { analyzeBeats, beatInfoFromTracker, nearestDownbeat, stepBeats, type BeatInfo } from "@/lib/audio/beats";
import { detectChorus, type ChorusResult } from "@/lib/audio/chorus";
import { computePeaks, decodeAudioFile, formatTime } from "@/lib/audio/decode";
import { playSection, stopPlayback } from "@/lib/audio/player";
import { detectKey, type MusicalKey } from "@/lib/audio/key";
import { detectBpm, type TempoMatch } from "@/lib/audio/tempo";
import {
  activeKeyShift,
  activeTempoMatch,
  checkSeparator,
  findBeatsWithAi,
  getProcessor,
  MASHUP_DURATION_SEC,
  vocalWindowSec,
  type MixSettings,
  type SeparatorStatus,
  type StageId,
} from "@/lib/processing";
import { saveMashup, storageMode } from "@/lib/store/mashups";
import { GenerateProgress } from "./GenerateProgress";
import { MixControls } from "./MixControls";
import { ResultPlayer } from "./ResultPlayer";
import { UploadSlot, type LoadedTrack } from "./UploadSlot";

type Side = "a" | "b";
type PerSide<T> = Record<Side, T>;

interface Result {
  url: string;
  blob: Blob;
  peaks: Float32Array;
  durationSec: number;
  processorId: string;
  tempo: TempoMatch | null;
  semitones: number;
  full: boolean;
  /** The sections used, and whether each one was the detected chorus. */
  sections: PerSide<{ startSec: number; lengthSec: number; chorus: boolean }>;
  inputKey: string;
}

const PEAK_BUCKETS = 600;

export function Studio() {
  const [separator, setSeparator] = useState<SeparatorStatus | null>(null);
  const processor = getProcessor(separator?.ok ?? false);
  const [tracks, setTracks] = useState<PerSide<LoadedTrack | null>>({ a: null, b: null });
  const [loading, setLoading] = useState<PerSide<boolean>>({ a: false, b: false });
  // Files whose beats the AI tracker is still working on; Generate waits for them.
  const [findingBeats, setFindingBeats] = useState<File[]>([]);
  const [errors, setErrors] = useState<PerSide<string | null>>({ a: null, b: null });
  const [previewing, setPreviewing] = useState<Side | null>(null);
  const [settings, setSettings] = useState<MixSettings>({
    vocalGain: 1,
    instGain: 0.9,
    tempoMatch: true,
    keyShift: "auto",
    length: "clip",
  });
  const [progress, setProgress] = useState<{ stage: StageId; fraction?: number } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tempo = activeTempoMatch({ bpm: tracks.a?.bpm ?? null }, { bpm: tracks.b?.bpm ?? null }, settings);
  const semitones = activeKeyShift({ key: tracks.a?.key ?? null }, { key: tracks.b?.key ?? null }, settings);
  // Sped-up vocals need more than 30 s of Song A; keep that window inside the track.
  const windowSec: PerSide<number> = { a: vocalWindowSec(tempo), b: MASHUP_DURATION_SEC };
  const clamp = (track: LoadedTrack | null, len: number) =>
    track && { ...track, startSec: latestBarBefore(track.beats, track.startSec, track.buffer.duration - len) };
  const view: PerSide<LoadedTrack | null> = { a: clamp(tracks.a, windowSec.a), b: clamp(tracks.b, windowSec.b) };

  const ready = Boolean(view.a && view.b);
  const generating = progress !== null;
  const waitingForBeats = findingBeats.some((f) => f === tracks.a?.file || f === tracks.b?.file);
  const full = settings.length === "full";
  const inputKey = [
    view.a?.file.name,
    view.a?.startSec.toFixed(1),
    view.a?.bpm,
    view.b?.file.name,
    view.b?.startSec.toFixed(1),
    view.b?.bpm,
    settings.vocalGain,
    settings.instGain,
    settings.tempoMatch,
    settings.length,
    semitones,
  ].join("|");
  const stale = result !== null && result.inputKey !== inputKey;

  useEffect(() => {
    void checkSeparator().then(setSeparator);
  }, []);

  useEffect(() => () => {
    stopPlayback();
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  const patch = <T,>(set: React.Dispatch<React.SetStateAction<PerSide<T>>>, side: Side, value: NoInfer<T>) =>
    set((prev) => ({ ...prev, [side]: value }));

  async function loadFile(side: Side, file: File) {
    patch(setErrors, side, null);
    patch(setLoading, side, true);
    try {
      const buffer = await decodeAudioFile(file, MASHUP_DURATION_SEC);
      // Let the "finding the chorus" state paint before the analysis blocks the main thread.
      await new Promise((r) => setTimeout(r, 0));
      const bpm = detectBpm(buffer);
      const rhythm = beatsFor(buffer, bpm, detectChorus(buffer, MASHUP_DURATION_SEC));
      // Start on the chorus; without one, about a third in, where the first chorus often lands.
      const guess = rhythm.chorus?.startSec ?? snapToBar(rhythm.beats, buffer.duration * 0.3);
      const startSec = latestBarBefore(rhythm.beats, guess, buffer.duration - MASHUP_DURATION_SEC);
      const peaks = computePeaks(buffer, PEAK_BUCKETS);
      patch(setTracks, side, { file, buffer, peaks, startSec, bpm, key: detectKey(buffer), ...rhythm, aiBeats: false });
      void refineBeatsWithAi(file, buffer);
    } catch (e) {
      patch(setErrors, side, e instanceof Error ? e.message : "Couldn't load that file.");
    } finally {
      patch(setLoading, side, false);
    }
  }

  /**
   * The in-browser beat estimate shows the song right away; when the AI service is running, its
   * trained beat tracker replaces it a few seconds later and the start points re-snap to its bars.
   */
  async function refineBeatsWithAi(file: File, buffer: AudioBuffer) {
    if (!(await checkSeparator()).ok) return;
    setFindingBeats((files) => [...files, file]);
    try {
      const result = await findBeatsWithAi(buffer);
      if (!result) return;
      const beats = beatInfoFromTracker(result.beats, result.downbeats);
      setTracks((prev) => {
        // The song may have been swapped to the other side (or removed) meanwhile.
        const side = (["a", "b"] as const).find((s) => prev[s]?.file === file);
        const track = side && prev[side];
        if (!side || !track) return prev;
        const onChorus = track.chorus && Math.abs(track.startSec - track.chorus.startSec) < 0.02;
        const chorus = track.chorus && { ...track.chorus, startSec: nearestDownbeat(beats, track.chorus.startSec) };
        const startSec = onChorus && chorus ? chorus.startSec : nearestDownbeat(beats, track.startSec);
        // Bar positions only: the in-browser BPM is drift-checked and stays in charge of tempo.
        return { ...prev, [side]: { ...track, beats, aiBeats: true, chorus, startSec } };
      });
    } finally {
      setFindingBeats((files) => files.filter((f) => f !== file));
    }
  }

  function clearTrack(side: Side) {
    if (previewing === side) stopPlayback();
    patch(setTracks, side, null);
    patch(setErrors, side, null);
  }

  function updateTrack(side: Side, change: Partial<LoadedTrack>) {
    setTracks((prev) => (prev[side] ? { ...prev, [side]: { ...prev[side]!, ...change } } : prev));
  }

  function togglePreview(side: Side) {
    const track = view[side];
    if (!track) return;
    if (previewing === side) {
      stopPlayback();
      return;
    }
    setPreviewing(side);
    void playSection(track.buffer, track.startSec, windowSec[side], () =>
      setPreviewing((p) => (p === side ? null : p)),
    );
  }

  function swap() {
    stopPlayback();
    setTracks(({ a, b }) => ({ a: b, b: a }));
    setErrors(({ a, b }) => ({ a: b, b: a }));
  }

  async function generate() {
    if (!view.a || !view.b) return;
    stopPlayback();
    setGenError(null);
    setSaveState("idle");
    setSaveError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // The separator may have been started or stopped since the page loaded.
      const status = await checkSeparator();
      setSeparator(status);
      const out = await getProcessor(status.ok).process(
        { vocals: view.a, instrumental: view.b, settings },
        (stage, fraction) => setProgress({ stage, fraction }),
        controller.signal,
      );
      controller.signal.throwIfAborted(); // cancelled during a step that can't be interrupted
      setResult({
        url: URL.createObjectURL(out.blob),
        blob: out.blob,
        peaks: computePeaks(out.buffer, PEAK_BUCKETS),
        durationSec: out.durationSec,
        processorId: out.processorId,
        tempo: out.tempo,
        semitones: out.semitones,
        sections: { a: usedSection(view.a, windowSec.a), b: usedSection(view.b, windowSec.b) },
        full,
        inputKey,
      });
      setTitle(`${baseName(view.a.file.name)} × ${baseName(view.b.file.name)}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setGenError(e instanceof Error ? e.message : "Something went wrong while mixing. Try again.");
      }
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!result || !view.a || !view.b) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveMashup({
        title: title.trim() || "Untitled mashup",
        songA: view.a.file,
        songB: view.b.file,
        aStartSec: view.a.startSec,
        bStartSec: view.b.startSec,
        vocalGain: settings.vocalGain,
        instGain: settings.instGain,
        aBpm: view.a.bpm,
        bBpm: view.b.bpm,
        tempoMatched: result.tempo !== null,
        keyShift: result.semitones,
        fullSong: result.full,
        processor: result.processorId,
        output: result.blob,
      });
      setSaveState("saved");
    } catch (e) {
      setSaveState("idle");
      setSaveError(e instanceof Error ? e.message : "Couldn't save the mashup.");
    }
  }

  const slotProps = (side: Side) => ({
    side,
    track: view[side],
    regionLengthSec: windowSec[side],
    fullSong: full,
    loading: loading[side],
    error: errors[side],
    previewing: previewing === side,
    onFile: (f: File) => loadFile(side, f),
    onClear: () => clearTrack(side),
    // Start points always sit on beat 1 of a bar, wherever they're dragged.
    onStartChange: (startSec: number) => updateTrack(side, { startSec: snapToBar(tracks[side]?.beats ?? null, startSec) }),
    onStepBars: (bars: number) => {
      const track = tracks[side];
      if (track?.beats) updateTrack(side, { startSec: stepBeats(track.beats, track.startSec, bars * 4) });
    },
    onBpmChange: (bpm: number | null) =>
      setTracks((prev) => {
        const track = prev[side];
        if (!track) return prev;
        // The AI tracker's beats don't depend on the BPM figure; keep them.
        if (track.aiBeats) return { ...prev, [side]: { ...track, bpm } };
        // A corrected tempo means a different beat grid: re-track and re-snap the start point.
        const rhythm = beatsFor(track.buffer, bpm, track.chorus);
        const onChorus = track.chorus && Math.abs(track.startSec - track.chorus.startSec) < 0.02;
        const startSec = onChorus && rhythm.chorus ? rhythm.chorus.startSec : snapToBar(rhythm.beats, track.startSec);
        return { ...prev, [side]: { ...track, bpm, ...rhythm, startSec } };
      }),
    onKeyChange: (key: MusicalKey | null) => updateTrack(side, { key }),
    onJumpToChorus: () => tracks[side]?.chorus && updateTrack(side, { startSec: tracks[side]!.chorus!.startSec }),
    onTogglePreview: () => togglePreview(side),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <UploadSlot {...slotProps("a")} />
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={swap}
            disabled={!tracks.a && !tracks.b}
            className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-fg disabled:opacity-40 md:flex-col md:px-2 md:py-3"
            title="Swap songs: take vocals from B and the instrumental from A"
          >
            <ArrowLeftRight size={16} aria-hidden />
            Swap
          </button>
        </div>
        <UploadSlot {...slotProps("b")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Mix" className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="font-display text-sm font-bold">Mix</h2>
          <MixControls
            settings={settings}
            onChange={setSettings}
            bpmA={tracks.a?.bpm}
            bpmB={tracks.b?.bpm}
            keyA={tracks.a?.key}
            keyB={tracks.b?.key}
          />
          <button
            type="button"
            onClick={generate}
            disabled={!ready || generating || waitingForBeats}
            className="bg-mashup flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-display text-sm font-bold text-on-accent shadow-lg transition-[transform,opacity] hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            <Sparkles size={16} aria-hidden />
            {generating
              ? "Generating…"
              : waitingForBeats
                ? "Finding the beat…"
              : result
                ? "Regenerate mashup"
                : full
                  ? "Generate full-song mashup"
                  : "Generate 30-second mashup"}
          </button>
          {!ready ? (
            <p className="text-center text-xs text-muted">Add both songs to start.</p>
          ) : (
            full &&
            separator?.ok && (
              <p className="text-center text-xs text-muted">
                Separating full songs takes about {estimateMinutes(view.a!, view.b!)} on this computer.
              </p>
            )
          )}
          {genError && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {genError}
            </p>
          )}
        </section>

        <section
          aria-label="Your mashup"
          className="flex min-h-64 flex-col gap-5 rounded-2xl border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-bold">Your mashup</h2>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted">
              {processor.label}
            </span>
          </div>
          {separator && !separator.ok && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              {separator.installed === false ? (
                "AI separation isn't available on this site yet, so the preview engine approximates the stems."
              ) : (
                <>
                  For clean vocals and a clean instrumental, start the AI separator in a terminal with{" "}
                  <code className="rounded bg-bg px-1 py-0.5 font-mono text-fg">npm run separator</code>. Until
                  then the preview engine approximates the stems.
                </>
              )}
            </p>
          )}

          {generating ? (
            <GenerateProgress
              stage={progress.stage}
              fraction={progress.fraction}
              tempoMatch={tempo !== null || semitones !== 0}
              onCancel={() => abortRef.current?.abort()}
            />
          ) : result ? (
            <>
              <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted tabular-nums">
                {result.full && <span>Full songs, lined up at:</span>}
                <SectionLabel side="a" section={result.sections.a} full={result.full} />
                <SectionLabel side="b" section={result.sections.b} full={result.full} />
              </p>
              {(result.tempo || result.semitones !== 0) && (
                <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted tabular-nums">
                  {result.tempo && (
                    <span>
                      Tempo: {result.tempo.sourceBpm.toFixed(1)} → {result.tempo.targetBpm.toFixed(1)} BPM
                    </span>
                  )}
                  {result.semitones !== 0 && (
                    <span>
                      Key: vocals {result.semitones > 0 ? "+" : "−"}
                      {Math.abs(result.semitones)} semitone{Math.abs(result.semitones) === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
              )}
              {stale && (
                <p className="rounded-lg bg-a-soft px-3 py-2 text-xs">
                  You changed the songs or mix since this was made. Regenerate to hear the changes.
                </p>
              )}
              <ResultPlayer
                url={result.url}
                peaks={result.peaks}
                durationSec={result.durationSec}
                title={title}
                onTitleChange={setTitle}
                onSave={save}
                saveState={saveState}
                saveError={saveError}
                storageLabel={
                  storageMode() === "supabase"
                    ? "Saving uploads both songs and the mashup to your Supabase project."
                    : "Saved mashups stay in this browser. Connect Supabase to keep them in the cloud."
                }
              />
            </>
          ) : (
            <EmptyResult />
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong p-6 text-center">
      <div className="flex items-center gap-2 font-display text-xs font-bold">
        <span className="text-a">A vocals</span>
        <span className="text-muted">+</span>
        <span className="text-b">B instrumental</span>
        <span className="text-muted">=</span>
        <span className="text-mashup">30 s mashup</span>
      </div>
      <p className="max-w-sm text-sm text-muted">
        Pick a 30-second section on each song, set the levels, then generate. You can play it here, download a WAV,
        or save it.
      </p>
    </div>
  );
}

/**
 * Both whole songs go through the separator. On an M2 it starts near 0.6 s per second of audio but
 * settles around 1:1 once the chip heats up, so estimate a minute per minute of music.
 */
function estimateMinutes(a: LoadedTrack, b: LoadedTrack) {
  const minutes = Math.max(1, Math.round((a.buffer.duration + b.buffer.duration) / 60));
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

function usedSection(track: LoadedTrack, lengthSec: number) {
  const chorus = track.chorus !== null && Math.abs(track.startSec - track.chorus.startSec) < 0.25;
  return { startSec: track.startSec, lengthSec, chorus };
}

function SectionLabel({ side, section, full }: { side: Side; section: Result["sections"][Side]; full: boolean }) {
  return (
    <span>
      <span className={side === "a" ? "text-a" : "text-b"}>{side === "a" ? "Vocals" : "Beat"}</span>{" "}
      {full
        ? formatTime(section.startSec)
        : `${formatTime(section.startSec)}–${formatTime(section.startSec + section.lengthSec)}`}
      {section.chorus && " (chorus)"}
    </span>
  );
}

/** Beats for a song at `bpm`, with the chorus moved onto the bar start nearest to where it was found. */
function beatsFor(buffer: AudioBuffer, bpm: number | null, chorus: ChorusResult | null) {
  if (!bpm) return { beats: null, chorus };
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const beats = analyzeBeats(channels, buffer.sampleRate, bpm);
  return { beats, chorus: chorus && { ...chorus, startSec: nearestDownbeat(beats, chorus.startSec) } };
}

function snapToBar(beats: BeatInfo | null, sec: number) {
  return beats ? nearestDownbeat(beats, sec) : sec;
}

/** `sec`, or if it's past `limit`, the last bar start that still fits (keeps the start on beat 1). */
function latestBarBefore(beats: BeatInfo | null, sec: number, limit: number) {
  if (sec <= limit) return Math.max(0, sec);
  if (!beats) return Math.max(0, limit);
  let bar = nearestDownbeat(beats, limit);
  for (let i = 0; bar > limit && i < 8; i++) bar = stepBeats(beats, bar, -4);
  return Math.max(0, bar);
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
