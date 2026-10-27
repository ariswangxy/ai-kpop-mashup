import type { BeatInfo } from "@/lib/audio/beats";
import { keyShiftBetween, type MusicalKey } from "@/lib/audio/key";
import { matchTempo, type TempoMatch } from "@/lib/audio/tempo";

export const MASHUP_DURATION_SEC = 30;

/** The tempo match a mix will use, or null when it's off, a BPM is unknown, or the tempos are too far apart. */
export function activeTempoMatch(
  vocals: Pick<TrackInput, "bpm">,
  instrumental: Pick<TrackInput, "bpm">,
  settings: Pick<MixSettings, "tempoMatch">,
): TempoMatch | null {
  if (!settings.tempoMatch || !vocals.bpm || !instrumental.bpm) return null;
  const match = matchTempo(vocals.bpm, instrumental.bpm);
  return match.inRange ? match : null;
}

/** Seconds of Song A needed for a 30 s mashup: more when the vocals get sped up. */
export function vocalWindowSec(match: TempoMatch | null) {
  return MASHUP_DURATION_SEC * (match?.speed ?? 1);
}

/** Semitones to shift the vocals: Song A's key onto Song B's in auto mode, else the manual value. */
export function activeKeyShift(
  vocals: Pick<TrackInput, "key">,
  instrumental: Pick<TrackInput, "key">,
  settings: Pick<MixSettings, "keyShift">,
): number {
  if (settings.keyShift !== "auto") return settings.keyShift;
  return vocals.key && instrumental.key ? keyShiftBetween(vocals.key, instrumental.key) : 0;
}

export interface TrackInput {
  file: File;
  buffer: AudioBuffer;
  startSec: number;
  bpm: number | null;
  key: MusicalKey | null;
  /** Tracked beats. When both songs have them, `startSec` sits exactly on a beat and the songs
   * line up exactly there; without them the mix falls back to matching the nearest beat. */
  beats: BeatInfo | null;
}

export interface MixSettings {
  vocalGain: number; // 0..1.5
  instGain: number; // 0..1.5
  tempoMatch: boolean;
  /** "auto" matches Song B's key; a number is a manual shift in semitones (0 = off). */
  keyShift: number | "auto";
  /**
   * "clip": 30 s from the picked sections. "full": all of Song A's vocals over all of Song B's
   * instrumental, lined up so the picked sections (choruses by default) land together.
   */
  length: "clip" | "full";
}

export interface MashupInput {
  vocals: TrackInput; // Song A
  instrumental: TrackInput; // Song B
  settings: MixSettings;
}

export interface MashupResult {
  buffer: AudioBuffer;
  blob: Blob;
  durationSec: number;
  processorId: string;
  /** Set when the vocals were stretched to the instrumental's tempo. */
  tempo: TempoMatch | null;
  /** Semitones the vocals were shifted. */
  semitones: number;
}

export const STAGES = [
  { id: "model", label: "Downloading the AI model (one time only)" },
  { id: "prepare", label: "Lining up your 30-second cuts" },
  { id: "vocals", label: "Isolating vocals from Song A" },
  { id: "instrumental", label: "Isolating the instrumental from Song B" },
  { id: "tempo", label: "Matching tempo and key, lining up beats" },
  { id: "mix", label: "Mixing and mastering" },
  { id: "render", label: "Rendering WAV" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/** `fraction` (0..1) reports progress within a long stage, e.g. separating a full song. */
export type ProgressHandler = (stage: StageId, fraction?: number) => void | Promise<void>;

/** A stem separation + mixing backend. Swap the mock for a real model later without touching the UI. */
export interface MashupProcessor {
  id: string;
  label: string;
  process(input: MashupInput, onProgress: ProgressHandler, signal?: AbortSignal): Promise<MashupResult>;
}
