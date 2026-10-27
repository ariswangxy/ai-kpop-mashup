/**
 * Beat and downbeat tracking.
 * Beats: the strongest beat grid at the song's BPM, re-fitted every 8 s so it follows small drifts.
 * Downbeats (beat 1 of each bar, 4/4 assumed): bars usually start with a kick and a chord change,
 * so each beat gets a "bar start" score from bass hits and harmonic change, and the bar position
 * whose beats score highest wins.
 */

import { chromaFrame, downmix, unit } from "./chroma";
import { gridPhase, onsetEnvelope, type OnsetEnvelope } from "./tempo";

const BEATS_PER_BAR = 4;
const WINDOW_SEC = 8;

export interface BeatInfo {
  /** Beat times in seconds. */
  times: Float32Array;
  /** How much each beat looks like the start of a bar (0..~1). */
  barStart: Float32Array;
  /** Onset strength at each beat; near 0 where the song has no beat (intro silence, breaks). */
  strength: Float32Array;
}

/** Onset frames of ~3 ms at 44.1 kHz: beats need to be placed to within a few milliseconds. */
const FINE_HOP = 128;

export function analyzeBeats(channels: Float32Array[], sampleRate: number, bpm: number): BeatInfo {
  // Timing comes from full-rate audio; chords only need the downsampled signal.
  const mono = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length;
  const window = Math.round(sampleRate * 0.02);
  const env = onsetEnvelope([mono], sampleRate, FINE_HOP, window);
  const bassEnv = onsetEnvelope([lowpass(mono, sampleRate, 150)], sampleRate, FINE_HOP, window);
  const { signal, rate } = downmix(channels, sampleRate);
  const times = trackBeats(env, bpm);
  const period = 60 / bpm;

  const strength = times.map((t) => peakNear(env, t, 0.05));
  const bass = times.map((t) => peakNear(bassEnv, t, 0.05));
  // Harmonic change: chroma of the half-beat before vs after each beat.
  const half = Math.round((period / 2) * rate);
  const change = times.map((t) => {
    const at = Math.round(t * rate);
    const before = unit(chromaFrame(signal, rate, Math.max(0, at - half - 2048)));
    const after = unit(chromaFrame(signal, rate, at + half - 2048));
    return 1 - before.reduce((s, v, i) => s + v * after[i], 0);
  });
  const changeNorm = normalise(change);
  const barStart = normalise(bass).map((b, i) => b + changeNorm[i]);
  return { times, barStart, strength };
}

/** Beats from a trained tracker (madmom): its downbeats are the bar starts, no guessing needed. */
export function beatInfoFromTracker(beats: number[], downbeats: number[]): BeatInfo {
  const times = Float32Array.from(beats);
  const isDownbeat = new Set(downbeats.map((d) => Math.round(d * 100)));
  return {
    times,
    barStart: times.map((t) => (isDownbeat.has(Math.round(t * 100)) ? 1 : 0)),
    strength: new Float32Array(times.length).fill(1),
  };
}

/** Beat times: in each 8 s window, the grid at `bpm` that best fits the onsets there. */
function trackBeats({ env, fps }: OnsetEnvelope, bpm: number): Float32Array {
  const period = 60 / bpm;
  const win = Math.round(WINDOW_SEC * fps);
  const beats: number[] = [];
  for (let from = 0; from < env.length; from += win) {
    const to = Math.min(env.length, from + win);
    if (to - from < win / 2 && beats.length) {
      // Short tail: continue the previous grid.
      for (let t = beats[beats.length - 1] + period; t < to / fps; t += period) beats.push(t);
      break;
    }
    const { phase } = gridPhase(env.subarray(from, to), fps, bpm);
    for (let t = from / fps + phase; t < to / fps; t += period) {
      // Where two windows' grids meet, drop a beat that lands too close to the previous one.
      if (!beats.length || t - beats[beats.length - 1] > period / 2) beats.push(t);
    }
  }
  return Float32Array.from(beats);
}

/** Index of the beat nearest to `sec`. */
export function nearestBeatIndex(info: BeatInfo, sec: number): number {
  const { times } = info;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && sec - times[lo - 1] < times[lo] - sec ? lo - 1 : lo;
}

/** Which beats around `index` are bar starts: returns d so that beats with (j − d) % 4 == 0 are. */
function barOffset(info: BeatInfo, index: number, span = 16): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let d = 0; d < BEATS_PER_BAR; d++) {
    let score = 0;
    for (let j = Math.max(0, index - span); j <= Math.min(info.times.length - 1, index + span); j++) {
      if ((((j - d) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0) score += info.barStart[j];
    }
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/** Position of the beat nearest `sec` within its bar, 1–4. */
export function beatInBar(info: BeatInfo, sec: number): number {
  const i = nearestBeatIndex(info, sec);
  const d = barOffset(info, i);
  return ((((i - d) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1;
}

/** The bar start (beat 1) nearest to `sec`. */
export function nearestDownbeat(info: BeatInfo, sec: number): number {
  const i = nearestBeatIndex(info, sec);
  const d = barOffset(info, i);
  const back = (((i - d) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  const candidates = [i - back, i - back + BEATS_PER_BAR].filter((j) => j >= 0 && j < info.times.length);
  if (!candidates.length) return sec;
  const best = candidates.reduce((a, b) => (Math.abs(info.times[b] - sec) < Math.abs(info.times[a] - sec) ? b : a));
  return info.times[best];
}

/** Move `steps` beats from the beat nearest `sec`. */
export function stepBeats(info: BeatInfo, sec: number, steps: number): number {
  const i = Math.max(0, Math.min(info.times.length - 1, nearestBeatIndex(info, sec) + steps));
  return info.times[i];
}

function peakNear({ env, fps }: OnsetEnvelope, sec: number, radiusSec: number) {
  let max = 0;
  const from = Math.max(0, Math.floor((sec - radiusSec) * fps));
  const to = Math.min(env.length - 1, Math.ceil((sec + radiusSec) * fps));
  for (let i = from; i <= to; i++) if (env[i] > max) max = env[i];
  return max;
}

/** One-pole low-pass, enough to isolate kick and bass hits. */
function lowpass(signal: Float32Array, rate: number, cutoff: number) {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate);
  const out = new Float32Array(signal.length);
  let y = 0;
  for (let i = 0; i < signal.length; i++) out[i] = y = (1 - a) * signal[i] + a * y;
  return out;
}

function normalise(values: Float32Array) {
  const sorted = Float32Array.from(values).sort();
  const top = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return values.map((v) => Math.min(1.5, v / top));
}
