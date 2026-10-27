"use client";

import { useId, useState } from "react";
import { Mic2, Music2, Pause, Play, Upload, X } from "lucide-react";
import type { BeatInfo } from "@/lib/audio/beats";
import type { ChorusResult } from "@/lib/audio/chorus";
import { ACCEPTED_EXTENSIONS, formatTime } from "@/lib/audio/decode";
import { ALL_KEYS, keyId, keyName, parseKeyId, type MusicalKey } from "@/lib/audio/key";
import { Waveform } from "./Waveform";

export interface LoadedTrack {
  file: File;
  buffer: AudioBuffer;
  peaks: Float32Array;
  startSec: number;
  bpm: number | null;
  key: MusicalKey | null;
  /** Tracked beats; start points snap to beat 1 of a bar. */
  beats: BeatInfo | null;
  /** True once the AI beat tracker has replaced the quick in-browser estimate. */
  aiBeats: boolean;
  chorus: ChorusResult | null;
}

interface UploadSlotProps {
  side: "a" | "b";
  track: LoadedTrack | null;
  /** Length of the highlighted section; longer than 30 s when the vocals will be sped up. */
  regionLengthSec: number;
  /** Full-song mode: the section is where the two songs line up, not what gets used. */
  fullSong: boolean;
  loading: boolean;
  error: string | null;
  previewing: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  onStartChange: (sec: number) => void;
  onBpmChange: (bpm: number | null) => void;
  onKeyChange: (key: MusicalKey | null) => void;
  onTogglePreview: () => void;
  onJumpToChorus: () => void;
  /** Arrow keys on the waveform: move the start point by bars. */
  onStepBars: (bars: number) => void;
}

const SIDES = {
  a: { name: "Song A", stem: "Vocals", hint: "The voice you want to hear", Icon: Mic2, accent: "var(--a)" },
  b: { name: "Song B", stem: "Instrumental", hint: "The beat it rides on", Icon: Music2, accent: "var(--b)" },
};

export function UploadSlot(props: UploadSlotProps) {
  const { side, track, loading, error, previewing } = props;
  const { name, stem, hint, Icon, accent } = SIDES[side];
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) props.onFile(file);
  };

  return (
    <section
      aria-label={`${name}: ${stem}`}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
          >
            <Icon size={18} aria-hidden />
          </span>
          <div>
            <p className="font-display text-sm font-bold">{name}</p>
            <p className="text-xs text-muted">{hint}</p>
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          Take {stem}
        </span>
      </header>

      {track ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={track.file.name}>
                {track.file.name}
              </p>
              <p className="font-mono text-xs text-muted tabular-nums">
                {formatTime(track.buffer.duration)} · {track.buffer.numberOfChannels === 1 ? "mono" : "stereo"} ·{" "}
                {(track.file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <BpmField
              key={`${track.file.name}:${track.bpm}`}
              id={`${inputId}-bpm`}
              bpm={track.bpm}
              accent={accent}
              onChange={props.onBpmChange}
            />
            <KeyField id={`${inputId}-key`} musicalKey={track.key} accent={accent} onChange={props.onKeyChange} />
            <button
              type="button"
              onClick={props.onClear}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label={`Remove ${name}`}
            >
              <X size={16} />
            </button>
          </div>

          <ChorusStatus track={track} accent={accent} onJump={props.onJumpToChorus} />

          <div className="rounded-xl bg-surface-2 p-3 pt-4">
            <Waveform
              peaks={track.peaks}
              durationSec={track.buffer.duration}
              region={{ startSec: track.startSec, lengthSec: Math.min(props.regionLengthSec, track.buffer.duration) }}
              onRegionChange={props.onStartChange}
              accent={accent}
              label={`${name} start point`}
              marker={track.chorus && { sec: track.chorus.startSec, label: "Chorus" }}
              onStep={track.beats ? (direction, big) => props.onStepBars(direction * (big ? 4 : 1)) : undefined}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted tabular-nums">
              {props.fullSong
                ? `Lines up at ${formatTime(track.startSec)}`
                : `Using ${formatTime(track.startSec)}–${formatTime(Math.min(track.startSec + props.regionLengthSec, track.buffer.duration))}`}
              <span className="hidden sm:inline"> · drag to move</span>
            </p>
            <button
              type="button"
              onClick={props.onTogglePreview}
              className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2"
            >
              {previewing ? <Pause size={13} /> : <Play size={13} />}
              {previewing ? "Stop" : "Preview section"}
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "bg-surface-2" : "border-line-strong hover:bg-surface-2"
          }`}
          style={dragging ? { borderColor: accent } : undefined}
        >
          {loading ? (
            <>
              <Equalizer color={accent} />
              <span className="text-sm text-muted">Reading audio and finding the chorus…</span>
            </>
          ) : (
            <>
              <Upload size={22} className="text-muted" aria-hidden />
              <span className="text-sm font-medium">Drop a track or click to browse</span>
              <span className="text-xs text-muted">MP3, WAV, M4A or OGG · up to 20 MB · at least 30 s</span>
            </>
          )}
          <input
            id={inputId}
            type="file"
            accept={["audio/*", ...ACCEPTED_EXTENSIONS].join(",")}
            className="sr-only"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onFile(file);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** Shows whether the window sits on the detected chorus, with a way back if it was moved. */
function ChorusStatus({ track, accent, onJump }: { track: LoadedTrack; accent: string; onJump: () => void }) {
  const { chorus } = track;
  if (!chorus) {
    return <p className="text-xs text-muted">Too short to find a repeating chorus. Drag to pick a section.</p>;
  }
  const clear = chorus.confidence >= 0.5;
  const onChorus = Math.abs(track.startSec - chorus.startSec) < 0.02;
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-muted">
        {clear ? (
          <>
            <span className="font-semibold" style={{ color: accent }}>
              Chorus found
            </span>{" "}
            at <span className="font-mono tabular-nums">{formatTime(chorus.startSec)}</span>
          </>
        ) : (
          <>
            No clear chorus. Best guess at{" "}
            <span className="font-mono tabular-nums">{formatTime(chorus.startSec)}</span>
          </>
        )}
      </p>
      {!onChorus && (
        <button
          type="button"
          onClick={onJump}
          className="rounded-full border border-line-strong px-2.5 py-1 font-medium transition-colors hover:bg-surface-2"
        >
          Jump to chorus
        </button>
      )}
    </div>
  );
}

/** Detected key, editable because detection can mix up related keys. */
function KeyField(props: {
  id: string;
  musicalKey: MusicalKey | null;
  accent: string;
  onChange: (key: MusicalKey | null) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end">
      <label htmlFor={props.id} className="text-[10px] font-semibold tracking-wider text-muted uppercase">
        Key
      </label>
      <select
        id={props.id}
        value={props.musicalKey ? keyId(props.musicalKey) : ""}
        onChange={(e) => props.onChange(parseKeyId(e.target.value))}
        title={props.musicalKey ? "Detected key. Change it if it's off." : "Couldn't detect the key. Pick it."}
        className="w-[6.5rem] rounded-md border border-line-strong bg-surface-2 px-1.5 py-1 text-sm outline-none focus:border-fg"
        style={{ color: props.accent }}
      >
        <option value="">Unknown</option>
        {ALL_KEYS.map((k) => (
          <option key={keyId(k)} value={keyId(k)}>
            {keyName(k)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Detected tempo, editable because detection can land on half or double time. Commits on blur or Enter. */
function BpmField(props: { id: string; bpm: number | null; accent: string; onChange: (bpm: number | null) => void }) {
  const shown = props.bpm ? props.bpm.toFixed(1) : "";
  const [text, setText] = useState(shown);
  const commit = () => {
    // The detected value is more precise than the box shows (0.01 BPM); keep it unless edited.
    if (text === shown) return;
    const v = Number(text);
    if (text.trim() === "") props.onChange(null);
    else if (v >= 40 && v <= 250) props.onChange(Math.round(v * 100) / 100);
    else setText(shown);
  };
  return (
    <div className="flex shrink-0 flex-col items-end">
      <label htmlFor={props.id} className="text-[10px] font-semibold tracking-wider text-muted uppercase">
        BPM
      </label>
      <input
        id={props.id}
        inputMode="decimal"
        value={text}
        placeholder="?"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        title={props.bpm ? "Detected tempo. Type a new value if it's off (e.g. half or double)." : "Couldn't detect the tempo. Type it in."}
        className="w-16 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-fg"
        style={{ color: props.accent }}
      />
    </div>
  );
}

export function Equalizer({ color, bars = 5 }: { color: string; bars?: number }) {
  return (
    <span aria-hidden className="flex h-6 items-end gap-1">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="eq-bar h-full w-1 rounded-full"
          style={{ background: color, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}
