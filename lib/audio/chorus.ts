/**
 * Chorus detection: a chorus is the section that repeats (same chords and melody) and is loud.
 * 1. Every 0.5 s, take a 12-bin chroma vector (energy per pitch class) and the loudness.
 * 2. Compare the song with itself at every time lag ≥ 10 s; sustained runs of similarity
 *    mark sections that repeat later on.
 * 3. Score each 30 s window by repetition and loudness, prefer windows that start
 *    where a repeated section begins, then snap the start onto the nearest hit.
 */

import { chromagram, downmix, STEP_SEC, unit } from "./chroma";
import { onsetEnvelope } from "./tempo";

const MIN_LAG_SEC = 10;
const MATCH_SEC = 8;

export interface ChorusResult {
  startSec: number;
  /** Share of the chosen window that repeats elsewhere in the song, 0..1. Below 0.5 there's no clear chorus. */
  confidence: number;
}

export function findChorus(channels: Float32Array[], sampleRate: number, windowSec = 30): ChorusResult | null {
  const { signal, rate } = downmix(channels, sampleRate);
  const { chroma, energy } = features(signal, rate);
  const steps = energy.length;
  const win = Math.round(windowSec / STEP_SEC);
  const minLag = Math.round(MIN_LAG_SEC / STEP_SEC);
  if (steps < win + minLag) return null;

  const rep = repetition(chroma, minLag, Math.round(MATCH_SEC / STEP_SEC));
  const loud = normalise(energy, percentile(energy, 0.95));
  const repNorm = normalise(rep, Math.max(...rep), Math.min(...rep));
  const blend = repNorm.map((r, i) => 0.6 * r + 0.4 * loud[i]);

  const prefix = new Float32Array(steps + 1);
  blend.forEach((v, i) => (prefix[i + 1] = prefix[i] + v));
  const mean = (from: number, len: number) => (prefix[from + len] - prefix[from]) / len;

  let best = 0;
  for (let s = 1; s + win <= steps; s++) if (mean(s, win) > mean(best, win)) best = s;

  // Within ±8 s, among near-best windows, start where the strongest repeated material begins.
  const head = Math.round(12 / STEP_SEC);
  const radius = Math.round(8 / STEP_SEC);
  let start = best;
  for (let s = Math.max(0, best - radius); s <= Math.min(steps - win, best + radius); s++) {
    if (mean(s, win) >= 0.95 * mean(best, win) && mean(s, head) > mean(start, head)) start = s;
  }

  start = nearestBoundary(chroma, energy, start, Math.min(start, Math.round(5 / STEP_SEC)), steps - win);

  let repeated = 0;
  for (let i = start; i < start + win; i++) if (rep[i] > 0) repeated++;
  const confidence = repeated / win;
  return { startSec: snapToHit(signal, rate, start * STEP_SEC), confidence };
}

export function detectChorus(buffer: AudioBuffer, windowSec = 30): ChorusResult | null {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  return findChorus(channels, buffer.sampleRate, windowSec);
}

/** Similarity above which a run counts as a real repeat (chroma of related chords overlaps a lot). */
const REPEAT_THRESHOLD = 0.6;

/**
 * For each step, how much the `match`-step run around it repeats elsewhere in the song, summed over
 * every lag it repeats at. Summing (not taking the max) rewards material that comes back several
 * times, like a chorus, over a section that only matches itself because its chord loop repeats.
 */
function repetition(chroma: Float32Array[], minLag: number, match: number) {
  const steps = chroma.length;
  const rep = new Float32Array(steps);
  const diag = new Float32Array(steps);
  for (let lag = minLag; lag < steps - match; lag++) {
    const n = steps - lag;
    for (let t = 0; t < n; t++) {
      let d = 0;
      for (let i = 0; i < 12; i++) d += chroma[t][i] * chroma[t + lag][i];
      diag[t] = d;
    }
    // Best match per step at this lag, so overlapping runs along one diagonal count once.
    const atLag = new Float32Array(steps);
    let run = 0;
    for (let t = 0; t < match; t++) run += diag[t];
    for (let t = 0; t + match <= n; t++) {
      const v = run / match - REPEAT_THRESHOLD;
      if (v > 0) {
        for (let i = t; i < t + match; i++) {
          if (v > atLag[i]) atLag[i] = v;
          if (v > atLag[i + lag]) atLag[i + lag] = v;
        }
      }
      run += (diag[t + match] ?? 0) - diag[t];
    }
    for (let i = 0; i < steps; i++) rep[i] += atLag[i];
  }
  return rep;
}

/**
 * Section boundaries are where the harmony or the loudness changes. Harmony compares the 8 s
 * before and after (a full 4-bar chord loop, so chord changes inside a section average out);
 * loudness is steady within a section, so it compares just 2 s either side for a sharp edge.
 * Move `start` to the strongest boundary within `radius` steps.
 */
function nearestBoundary(
  chroma: Float32Array[],
  energy: Float32Array,
  start: number,
  radius: number,
  maxStart: number,
) {
  const side = Math.round(8 / STEP_SEC);
  const near = Math.round(2 / STEP_SEC);
  const meanChroma = (from: number, to: number) => {
    const m = new Float32Array(12);
    for (let t = from; t < to; t++) for (let i = 0; i < 12; i++) m[i] += chroma[t][i];
    return unit(m);
  };
  const meanEnergy = (from: number, to: number) => energy.subarray(from, to).reduce((s, v) => s + v, 0) / (to - from);
  const novelty = (t: number) => {
    const [a, b] = [meanChroma(t - side, t), meanChroma(t, t + side)];
    const harmony = 1 - a.reduce((s, v, i) => s + v * b[i], 0);
    // A 4× change in loudness scores 1.
    const loudness = Math.abs(Math.log((meanEnergy(t, t + near) + 1e-6) / (meanEnergy(t - near, t) + 1e-6))) / Math.log(4);
    // Harmony is the noisier cue (related chords overlap), so loudness leads.
    return 0.25 * harmony + Math.min(1, loudness);
  };
  let best = start;
  let bestNovelty = 0.3; // below this there's no clear boundary; keep the start
  for (let t = Math.max(side, start - radius); t <= Math.min(maxStart, start + radius, chroma.length - side); t++) {
    const n = novelty(t);
    if (n > bestNovelty) [best, bestNovelty] = [t, n];
  }
  return best;
}

/** Chroma with the song's overall key profile removed, so sections differ by their chords. */
function features(signal: Float32Array, rate: number) {
  const { chroma, energy } = chromagram(signal, rate);
  const steps = chroma.length;
  const avg = new Float32Array(12);
  chroma.forEach((c) => unit(c).forEach((v, i) => (avg[i] += v / steps)));
  chroma.forEach((c) => {
    for (let i = 0; i < 12; i++) c[i] -= avg[i];
    unit(c);
  });
  return { chroma, energy };
}

/** Move the start onto the strongest hit within ±0.6 s so the cut lands on a beat. */
function snapToHit(signal: Float32Array, rate: number, startSec: number) {
  const from = Math.max(0, Math.floor((startSec - 0.6) * rate));
  const to = Math.min(signal.length, Math.floor((startSec + 0.6) * rate));
  if (to - from < rate * 0.2) return startSec;
  const { env, fps } = onsetEnvelope([signal.subarray(from, to)], rate);
  let peak = 0;
  env.forEach((v, i) => v > env[peak] && (peak = i));
  return env[peak] > 0 ? from / rate + peak / fps : startSec;
}

function percentile(values: Float32Array, p: number) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.floor(p * (sorted.length - 1))] || 1;
}

function normalise(values: Float32Array, max: number, min = 0) {
  const range = max - min || 1;
  return values.map((v) => Math.max(0, Math.min(1, (v - min) / range)));
}
