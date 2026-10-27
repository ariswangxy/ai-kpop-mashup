/**
 * The pure parts of running beat_this (CPJKU, MIT; "Beat This!", ISMIR 2024) in the browser: the
 * log-mel spectrogram it was trained on, how a song is cut into the model's 30 s chunks, and
 * turning its frame-wise logits into beat and downbeat times. Ported from beat_this 1.1.0
 * (preprocessing.LogMelSpect, inference.split_piece / aggregate_prediction, postprocessor
 * "minimal"). beats-worker.ts runs the model itself.
 */
import { reflectPad, stft } from "demucs-web";

/** The small checkpoint (small0) exported to ONNX, served from this site. */
export const BEAT_MODEL_URL = "/models/beat_this_small0.onnx";
export const BEAT_RATE = 22050;
export const FPS = 50;
const N_FFT = 1024;
const HOP = 441; // 22050 / 50
const N_MELS = 128;
const F_MIN = 30;
const F_MAX = 11000;
const LOG_MULTIPLIER = 1000;

/** Slaney mel scale (torchaudio mel_scale="slaney"): linear below 1 kHz, logarithmic above. */
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27;
const hzToMel = (hz: number) => (hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP : hz / F_SP);
const melToHz = (mel: number) => (mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL)) : F_SP * mel);

/** Triangular mel filters, [bin][mel] like torchaudio.functional.melscale_fbanks (norm=None). */
export function melFilterbank(): Float32Array[] {
  const bins = N_FFT / 2 + 1;
  const mMin = hzToMel(F_MIN);
  const mMax = hzToMel(F_MAX);
  const f = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  return Array.from({ length: bins }, (_, b) => {
    const hz = (b * (BEAT_RATE / 2)) / (bins - 1);
    return Float32Array.from({ length: N_MELS }, (_, m) => {
      const down = (hz - f[m]) / (f[m + 1] - f[m]);
      const up = (f[m + 2] - hz) / (f[m + 2] - f[m + 1]);
      return Math.max(0, Math.min(down, up));
    });
  });
}

let filterbank: Float32Array[] | null = null;

/**
 * log(1 + 1000 · mel magnitude) of mono audio at 22.05 kHz: frames × 128, row-major. Matches
 * torchaudio's MelSpectrogram(n_fft=1024, hop=441, f 30-11000 Hz, power=1, normalized="frame_length"),
 * which pads by reflection so frame i is centred on sample i·441.
 */
export function logMelSpectrogram(signal: Float32Array): { data: Float32Array; frames: number } {
  filterbank ??= melFilterbank();
  // demucs-web's stft already scales by 1/sqrt(n_fft), as normalized="frame_length" does.
  const spec = stft(reflectPad(signal, N_FFT / 2, N_FFT / 2), N_FFT, HOP);
  const data = new Float32Array(spec.numFrames * N_MELS);
  for (let t = 0; t < spec.numFrames; t++) {
    const row = data.subarray(t * N_MELS, (t + 1) * N_MELS);
    for (let b = 0; b < spec.numBins; b++) {
      const k = t * spec.numBins + b;
      const mag = Math.hypot(spec.real[k], spec.imag[k]);
      if (mag === 0) continue;
      const weights = filterbank[b];
      for (let m = 0; m < N_MELS; m++) row[m] += mag * weights[m];
    }
    for (let m = 0; m < N_MELS; m++) row[m] = Math.log1p(LOG_MULTIPLIER * row[m]);
  }
  return { data, frames: spec.numFrames };
}

/** The model sees 30 s at a time; each chunk's first and last 6 frames are unreliable and dropped. */
export const CHUNK_FRAMES = 1500;
const BORDER = 6;

/**
 * Where each chunk starts (may be negative: zero-padded) so that the trusted middles cover every
 * frame, with the last chunk pulled back to end at the end of the song.
 */
export function chunkStarts(frames: number): number[] {
  const starts: number[] = [];
  for (let s = -BORDER; s < frames - BORDER; s += CHUNK_FRAMES - 2 * BORDER) starts.push(s);
  if (frames > CHUNK_FRAMES - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK_FRAMES - BORDER);
  return starts;
}

/**
 * The chunk starting at frame `start` (frames × 128): up to 1500 frames of the song, zero-padded
 * where it starts before the song or reaches past its end (by at most the border).
 */
export function chunkAt(spect: { data: Float32Array; frames: number }, start: number) {
  const from = Math.max(start, 0);
  const to = Math.min(start + CHUNK_FRAMES, spect.frames);
  const left = from - start;
  const right = Math.max(0, Math.min(BORDER, start + CHUNK_FRAMES - spect.frames));
  const frames = left + (to - from) + right;
  const data = new Float32Array(frames * N_MELS);
  data.set(spect.data.subarray(from * N_MELS, to * N_MELS), left * N_MELS);
  return { data, frames };
}

/**
 * Writes one chunk's predictions (minus its borders) into the whole-song arrays. Call in reverse
 * chunk order so earlier chunks win where they overlap, as beat_this's "keep_first" does.
 */
export function placeChunk(song: Float32Array, start: number, chunk: Float32Array) {
  for (let i = BORDER; i < chunk.length - BORDER; i++) {
    const at = start + i;
    if (at >= 0 && at < song.length) song[at] = chunk[i];
  }
}

/** Frames whose logit is above 0 (probability > 0.5) and the largest within ±3 frames (±60 ms). */
function peaks(logits: Float32Array): number[] {
  const found: number[] = [];
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] <= 0) continue;
    let max = -Infinity;
    for (let j = Math.max(0, i - 3); j <= Math.min(logits.length - 1, i + 3); j++) max = Math.max(max, logits[j]);
    if (logits[i] === max) found.push(i);
  }
  return found;
}

/** Merges runs of adjacent peak frames into their average, as beat_this's deduplicate_peaks does. */
export function deduplicatePeaks(frames: number[]): number[] {
  const out: number[] = [];
  let p = frames[0];
  let count = 1;
  for (const next of frames.slice(1)) {
    if (next - p <= 1) {
      count++;
      p += (next - p) / count;
    } else {
      out.push(p);
      p = next;
      count = 1;
    }
  }
  if (frames.length) out.push(p);
  return out;
}

/** Beat and downbeat times in seconds from whole-song logits; downbeats snap to the nearest beat. */
export function logitsToBeats(beatLogits: Float32Array, downbeatLogits: Float32Array) {
  const beats = deduplicatePeaks(peaks(beatLogits)).map((f) => f / FPS);
  const snapped = deduplicatePeaks(peaks(downbeatLogits)).map((f) => {
    const t = f / FPS;
    return beats.length ? beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best)) : t;
  });
  return { beats, downbeats: [...new Set(snapped)].sort((a, b) => a - b) };
}
