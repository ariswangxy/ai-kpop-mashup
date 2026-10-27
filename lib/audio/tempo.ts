/**
 * Tempo detection and matching.
 * BPM comes from autocorrelating an onset envelope (rises in loudness, i.e. hits).
 */

const HOP_SEC = 0.0116; // 512 samples at 44.1 kHz
const WINDOW_SEC = 0.04;
const MIN_BPM = 70;
const MAX_BPM = 180;
/** How far we're willing to stretch vocals before it sounds broken. */
export const MAX_STRETCH = 0.25;

export interface OnsetEnvelope {
  env: Float32Array;
  fps: number;
}

/** Onset strength per frame: positive jumps in log energy of the mono mix. */
/**
 * Onset strength per frame of `hop` samples: positive jumps in log energy of the mono mix.
 * Energy is measured over the `window` samples ending at each frame. Both default to fixed
 * durations (~12 ms steps, 40 ms window) so results don't depend on the sample rate, and a window
 * longer than a step stops chords' slow beating from rippling the energy into fake onsets.
 */
export function onsetEnvelope(
  channels: Float32Array[],
  sampleRate: number,
  hop = Math.round(sampleRate * HOP_SEC),
  window = Math.max(hop, Math.round(sampleRate * WINDOW_SEC)),
): OnsetEnvelope {
  const length = channels[0].length;
  const frames = Math.floor(length / hop);
  // Running sum of squared samples, so any window's energy is one subtraction.
  const cumulative = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) {
    let sq = 0;
    for (const data of channels) sq += data[i] * data[i];
    cumulative[i + 1] = cumulative[i] + sq;
  }
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    const end = (f + 1) * hop;
    const start = Math.max(0, end - window);
    const logE = Math.log(1e-9 + (cumulative[end] - cumulative[start]) / window);
    env[f] = f === 0 ? 0 : Math.max(0, logE - prev);
    prev = logE;
  }
  return { env, fps: sampleRate / hop };
}

/** Most likely tempo in [70, 180] BPM, or null when there's no clear pulse. */
export function estimateBpm({ env, fps }: OnsetEnvelope): number | null {
  const n = env.length;
  // Smooth so beats that fall between frames still line up at the nearest whole-frame lag.
  const kernel = [1, 2, 3, 2, 1];
  const smooth = env.map((_, i) => kernel.reduce((s, k, j) => s + k * (env[i + j - 2] ?? 0), 0) / 9);
  const mean = smooth.reduce((s, v) => s + v, 0) / n;
  const x = smooth.map((v) => v - mean);
  const minLag = Math.floor((60 * fps) / MAX_BPM);
  const maxLag = Math.ceil((60 * fps) / MIN_BPM);
  if (n < maxLag * 4) return null;

  const r = new Float32Array(maxLag * 4 + 2);
  for (let lag = minLag; lag < r.length; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    r[lag] = s / (n - lag);
  }

  // A real beat also repeats at 2 beats and at 4 (one bar of 4/4), where the strongest hits are.
  // Counting those stops a strong once-a-bar kick from pulling the estimate onto a beat that
  // doesn't fit the bar (e.g. 5 "beats" per bar). There's also a mild pull toward ~120 BPM.
  const score = (lag: number) => {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    return (r[lag] + 0.5 * r[lag * 2] + 0.5 * r[lag * 4]) * prior;
  };
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
  if (score(best) <= 0) return null;

  // Parabolic interpolation for sub-frame precision.
  const [a, b, c] = [score(best - 1), score(best), score(best + 1)];
  const denom = a - 2 * b + c;
  const lag = best + (denom < 0 ? (0.5 * (a - c)) / denom : 0);
  return Math.round(((60 * fps) / lag) * 10) / 10;
}

interface ChannelSource {
  sampleRate: number;
  numberOfChannels: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

/** Detect BPM from up to 60 s of the track, skipping the intro. */
/** Detect BPM: a coarse estimate from 60 s of the song, then refined against the whole song. */
export function detectBpm(buffer: ChannelSource): number | null {
  const rate = buffer.sampleRate;
  const total = Math.floor(buffer.duration * rate);
  const channel = (from: number, to: number) =>
    Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).subarray(from, to));

  const startSec = Math.min(buffer.duration * 0.2, Math.max(0, buffer.duration - 60));
  const start = Math.floor(startSec * rate);
  const coarse = estimateBpm(onsetEnvelope(channel(start, Math.min(start + 60 * rate, total)), rate));
  if (!coarse) return null;

  // Skip intro and outro, where there's often no steady beat.
  const body = onsetEnvelope(channel(Math.floor(total * 0.1), Math.floor(total * 0.9)), rate);
  return Math.round(refineBpm(body, coarse) * 100) / 100;
}

/**
 * Correct a tempo estimate by following the beat: measure where the beat grid falls in successive
 * 8 s windows. If the BPM is slightly off, the grid's position drifts steadily from window to window;
 * the median drift gives the correction. Later passes compare windows further apart for precision.
 */
export function refineBpm({ env, fps }: OnsetEnvelope, bpm: number): number {
  const win = Math.round(8 * fps);
  const windows = Math.floor(env.length / win);
  let current = bpm;

  // One correction step comparing windows `spacing` apart. Returns the relative drift, or null.
  const measureDrift = (spacing: number) => {
    const period = 60 / current;
    const grid = Array.from({ length: windows }, (_, w) => {
      const from = w * win;
      const { phase, strength } = gridPhase(env.subarray(from, from + win), fps, current);
      return { at: from / fps + phase, strength };
    });
    // Ignore windows without a clear beat (breakdowns, silence).
    const strengths = grid.map((g) => g.strength).sort((x, y) => x - y);
    const minStrength = 0.5 * strengths[Math.floor(strengths.length / 2)];
    const drifts: number[] = [];
    for (let w = 0; w + spacing < windows; w++) {
      if (grid[w].strength < minStrength || grid[w + spacing].strength < minStrength) continue;
      const elapsed = grid[w + spacing].at - grid[w].at;
      // How far the later grid sits from where the current tempo says a beat should be.
      drifts.push((elapsed - Math.round(elapsed / period) * period) / elapsed);
    }
    if (drifts.length < 3) return null;
    drifts.sort((x, y) => x - y);
    return drifts[Math.floor(drifts.length / 2)];
  };

  // Wider spacing is more precise but can only see errors below a quarter beat over that span,
  // so settle each spacing before moving to the next.
  for (const spacing of [1, 3, 6]) {
    if (windows <= spacing + 2) break;
    const settled = (0.25 * 60) / current / (8 * spacing * 2); // error the next spacing can still see
    for (let i = 0; i < 4; i++) {
      const drift = measureDrift(spacing);
      if (drift === null) return current;
      const next = current / (1 + drift);
      if (Math.abs(next / bpm - 1) > 0.05) return current; // implausibly far from the estimate
      current = next;
      if (Math.abs(drift) < settled / 4) break;
    }
  }
  return current;
}

/** Strongest beat grid at `bpm`: its offset from the start (seconds, sub-frame) and how strong it is. */
export function gridPhase(env: Float32Array, fps: number, bpm: number) {
  const period = (60 * fps) / bpm;
  const at = (t: number) => {
    const i = Math.floor(t);
    const frac = t - i;
    return (env[i] ?? 0) * (1 - frac) + (env[i + 1] ?? 0) * frac;
  };
  let best = { phase: 0, strength: -1 };
  for (let phase = 0; phase < period; phase += 0.25) {
    let sum = 0;
    for (let t = phase; t < env.length; t += period) sum += at(t);
    if (sum > best.strength) best = { phase, strength: sum };
  }
  return { phase: best.phase / fps, strength: best.strength };
}

/** Seconds from the start of the envelope to the first beat of the strongest beat grid at `bpm`. */
export function beatPhase({ env, fps }: OnsetEnvelope, bpm: number): number {
  return gridPhase(env, fps, bpm).phase;
}

export interface TempoMatch {
  /** Playback speed for the vocals: >1 speeds them up. */
  speed: number;
  /** Song A's tempo, halved or doubled when that's closer to Song B. */
  sourceBpm: number;
  targetBpm: number;
  inRange: boolean;
}

/** Fit Song A's tempo to Song B's, allowing half or double time so 70 BPM can ride a 140 BPM beat. */
export function matchTempo(bpmA: number, bpmB: number): TempoMatch {
  const sourceBpm = [bpmA / 2, bpmA, bpmA * 2].reduce((best, c) =>
    Math.abs(Math.log(bpmB / c)) < Math.abs(Math.log(bpmB / best)) ? c : best,
  );
  const speed = bpmB / sourceBpm;
  return {
    speed,
    sourceBpm,
    targetBpm: bpmB,
    inRange: speed >= 1 - MAX_STRETCH && speed <= 1 + MAX_STRETCH,
  };
}

/** Shift (seconds) to apply to stretched vocals so their beats land on the instrumental's beats. */
export function alignmentOffset(phaseA: number, phaseB: number, speed: number, targetBpm: number): number {
  const beat = 60 / targetBpm;
  let shift = (phaseB - phaseA / speed) % beat;
  if (shift < 0) shift += beat;
  return shift > beat / 2 ? shift - beat : shift;
}
