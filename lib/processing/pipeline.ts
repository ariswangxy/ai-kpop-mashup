import { renderMashup, sliceChannels, type ChannelSlice } from "@/lib/audio/dsp";
import { alignmentOffset, beatPhase, onsetEnvelope } from "@/lib/audio/tempo";
import { wavBlob } from "@/lib/audio/wav";
import {
  activeKeyShift,
  activeTempoMatch,
  MASHUP_DURATION_SEC,
  vocalWindowSec,
  type MashupInput,
  type MashupResult,
  type ProgressHandler,
} from "./types";

/** Turns audio from a song into one stem, reporting progress (0..1) on long inputs. */
export type Separator = (
  slice: ChannelSlice,
  keep: "vocals" | "instrumental",
  signal?: AbortSignal,
  onFraction?: (fraction: number) => void,
) => Promise<ChannelSlice>;

export const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelled", "AbortError"));
    });
  });

/**
 * Shared mashup steps: cut the audio, separate stems, match tempo and key, mix, encode.
 * With `separate` null the mix falls back to the DSP approximation in renderMashup.
 *
 * The picked sections (choruses by default) are the anchors: a clip mixes just those, and a full
 * song places all of Song A's vocals so its section lands on Song B's, on the beat.
 */
export async function runMashup(
  { vocals, instrumental, settings }: MashupInput,
  reportProgress: ProgressHandler,
  signal: AbortSignal | undefined,
  separate: Separator | null,
  processorId: string,
): Promise<MashupResult> {
  // Every step boundary is also where a cancel takes effect.
  const onProgress: ProgressHandler = (stage, fraction) => {
    signal?.throwIfAborted();
    return reportProgress(stage, fraction);
  };
  await onProgress("prepare");
  const tempo = activeTempoMatch(vocals, instrumental, settings);
  const semitones = activeKeyShift(vocals, instrumental, settings);
  const speed = tempo?.speed ?? 1;
  const full = settings.length === "full";

  const anchorA = sliceChannels(vocals.buffer, vocals.startSec, vocalWindowSec(tempo));
  const anchorB = sliceChannels(instrumental.buffer, instrumental.startSec, MASHUP_DURATION_SEC);
  const vocalSource = full ? sliceChannels(vocals.buffer, 0, vocals.buffer.duration) : anchorA;
  const instSource = full ? sliceChannels(instrumental.buffer, 0, instrumental.buffer.duration) : anchorB;

  const stem = async (source: ChannelSlice, keep: "vocals" | "instrumental") => {
    await onProgress(keep);
    return separate ? separate(source, keep, signal, (f) => onProgress(keep, f)) : source;
  };
  const vocalStem = await stem(vocalSource, "vocals");
  const instStem = await stem(instSource, "instrumental");

  // Where the vocals start on the output timeline. Each song's start point is a beat (beat 1 of a
  // bar by default): Song A's lands exactly on Song B's. A clip starts both there; a full song
  // places all of Song A (sped up by the tempo match) around that point.
  let vocalOffsetSec = full ? instrumental.startSec - vocals.startSec / speed : 0;
  const onBeats = vocals.beats !== null && instrumental.beats !== null;
  if (tempo || semitones) {
    await onProgress("tempo");
    await wait(50, signal); // let the progress UI paint before the CPU-heavy stretch
  }
  if (tempo && !onBeats) {
    // No beat tracking: nudge to the nearest beat instead. Beats are easiest to find in the full
    // mixes, which still have their drums.
    const phaseA = beatPhase(onsetEnvelope(anchorA.channels, anchorA.sampleRate), tempo.sourceBpm);
    const phaseB = beatPhase(onsetEnvelope(anchorB.channels, anchorB.sampleRate), tempo.targetBpm);
    vocalOffsetSec += alignmentOffset(phaseA, phaseB, speed, tempo.targetBpm);
  }

  const durationSec = full ? instrumental.buffer.duration : MASHUP_DURATION_SEC;
  await onProgress("mix");
  const buffer = await renderMashup({
    vocals: vocalStem,
    instrumental: instStem,
    vocalGain: settings.vocalGain,
    instGain: settings.instGain,
    durationSec,
    fadeSec: 1.5,
    vocalSpeed: tempo?.speed,
    vocalOffsetSec,
    vocalSemitones: semitones,
    separated: separate !== null,
  });

  await onProgress("render");
  const blob = wavBlob(buffer);
  return { buffer, blob, durationSec, processorId, tempo, semitones };
}
