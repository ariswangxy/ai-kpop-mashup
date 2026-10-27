/**
 * Musical key detection (Krumhansl–Schmuckler): sum the song's chroma into one 12-note profile and
 * correlate it with the major and minor key profiles in all 12 transpositions.
 */

import { chromagram, downmix, unit } from "./chroma";

export const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/** Largest shift we'll apply to vocals; past this they start to sound unnatural. */
export const MAX_KEY_SHIFT = 6;

export interface MusicalKey {
  tonic: number; // pitch class, 0 = C
  mode: "major" | "minor";
}

// Krumhansl–Kessler probe-tone profiles, tonic first.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const ALL_KEYS: MusicalKey[] = (["major", "minor"] as const).flatMap((mode) =>
  PITCH_NAMES.map((_, tonic) => ({ tonic, mode })),
);

export function keyName(key: MusicalKey) {
  return `${PITCH_NAMES[key.tonic]} ${key.mode}`;
}

export function keyId(key: MusicalKey) {
  return `${key.tonic}:${key.mode}`;
}

export function parseKeyId(id: string): MusicalKey | null {
  const [tonic, mode] = id.split(":");
  return mode === "major" || mode === "minor" ? { tonic: Number(tonic), mode } : null;
}

/** Best-matching key for a 12-note profile, or null when there's no tonal content. */
export function estimateKey(profile: ArrayLike<number>): MusicalKey | null {
  if (Array.from(profile).every((v) => v === 0)) return null;
  let best: MusicalKey | null = null;
  let bestScore = -Infinity;
  for (const key of ALL_KEYS) {
    const template = key.mode === "major" ? MAJOR : MINOR;
    const score = correlation(profile, (i) => template[(i - key.tonic + 12) % 12]);
    if (score > bestScore) [best, bestScore] = [key, score];
  }
  return best;
}

export function findKey(channels: Float32Array[], sampleRate: number): MusicalKey | null {
  const { signal, rate } = downmix(channels, sampleRate);
  const { chroma, energy } = chromagram(signal, rate);
  // Weight each step by loudness so quiet intros and fades count less.
  const profile = new Float32Array(12);
  chroma.forEach((c, s) => unit(c).forEach((v, i) => (profile[i] += v * energy[s])));
  return estimateKey(profile);
}

export function detectKey(buffer: AudioBuffer): MusicalKey | null {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  return findKey(channels, buffer.sampleRate);
}

/** Minor keys share their notes with the major key three semitones up (A minor ↔ C major). */
function relativeMajor(key: MusicalKey) {
  return key.mode === "major" ? key.tonic : (key.tonic + 3) % 12;
}

/** Wrap a semitone difference into −6…+5. */
function wrap(semitones: number) {
  const d = ((semitones % 12) + 12) % 12;
  return d >= MAX_KEY_SHIFT ? d - 12 : d;
}

/**
 * Smallest shift (−6…+5 semitones) that puts `from` in the same key as `to`. Relative major and
 * minor share every note (A minor = C major), so either counts. A vocal sings over the other song's
 * chords for the whole mashup, so anything short of the same notes will clash.
 */
export function keyShiftBetween(from: MusicalKey, to: MusicalKey): number {
  return wrap(relativeMajor(to) - relativeMajor(from));
}

export function transpose(key: MusicalKey, semitones: number): MusicalKey {
  return { tonic: (((key.tonic + semitones) % 12) + 12) % 12, mode: key.mode };
}

function correlation(a: ArrayLike<number>, b: (i: number) => number) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i] / 12;
    mb += b(i) / 12;
  }
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b(i) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}
