/**
 * Chroma: how much energy each of the 12 pitch classes (C, C#, … B) has, every 0.5 s.
 * Shared by chorus detection (which sections repeat) and key detection (which notes the song uses).
 */

export const STEP_SEC = 0.5;
const FFT_SIZE = 4096;
const TARGET_RATE = 11025;

/** Average to mono and decimate to ~11 kHz; chords and melody live well below 5 kHz. */
export function downmix(channels: Float32Array[], sampleRate: number) {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const length = Math.floor(channels[0].length / factor);
  const signal = new Float32Array(length);
  const scale = 1 / (factor * channels.length);
  for (const data of channels) {
    for (let i = 0; i < length; i++) {
      let s = 0;
      for (let j = 0; j < factor; j++) s += data[i * factor + j];
      signal[i] += s * scale;
    }
  }
  return { signal, rate: sampleRate / factor };
}

/** Raw chroma vectors (not normalised) and RMS loudness per 0.5 s step. */
export function chromagram(signal: Float32Array, rate: number) {
  const hop = Math.round(rate * STEP_SEC);
  const steps = Math.max(0, Math.floor((signal.length - FFT_SIZE) / hop) + 1);
  const chroma: Float32Array[] = [];
  const energy = new Float32Array(steps);
  for (let s = 0; s < steps; s++) {
    const offset = s * hop;
    let e = 0;
    for (let i = 0; i < hop && offset + i < signal.length; i++) e += signal[offset + i] ** 2;
    energy[s] = Math.sqrt(e / hop);
    chroma.push(chromaFrame(signal, rate, offset));
  }
  return { chroma, energy };
}

const WINDOW = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
const pitchMaps = new Map<number, Int8Array>();

/** FFT bins between C2 and C7 mapped to pitch classes (−1 = ignored), cached per sample rate. */
function pitchMap(rate: number) {
  let map = pitchMaps.get(rate);
  if (!map) {
    map = new Int8Array(FFT_SIZE / 2).fill(-1);
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const f = (k * rate) / FFT_SIZE;
      if (f >= 65 && f <= 2100) map[k] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12;
    }
    pitchMaps.set(rate, map);
  }
  return map;
}

/** Chroma of one ~0.37 s frame starting at sample `offset` (zero-padded past the end). */
export function chromaFrame(signal: Float32Array, rate: number, offset: number): Float32Array {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) re[i] = (signal[offset + i] ?? 0) * WINDOW[i];
  fft(re, im);
  const map = pitchMap(rate);
  const c = new Float32Array(12);
  for (let k = 1; k < FFT_SIZE / 2; k++) {
    if (map[k] >= 0) c[map[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return c;
}

export const CHROMA_FRAME_SEC = (rate: number) => FFT_SIZE / rate;

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export function unit(v: Float32Array) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
