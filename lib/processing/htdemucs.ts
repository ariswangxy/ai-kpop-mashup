/**
 * The pure parts of running htdemucs in the browser (see browser-worker.ts): which model to load,
 * how a song is cut into model-sized segments, and how the overlapping results are blended.
 */

/** htdemucs (MIT) exported to ONNX by demucs-web, pinned to a commit so it can't change under us. */
export const MODEL_URL =
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx";
export const MODEL_BYTES = 180_534_758;
export const MODEL_MB = Math.round(MODEL_BYTES / 1e6);
/** Cache Storage bucket for the model. Hugging Face sends it as no-store, so the HTTP cache won't keep it. */
export const MODEL_CACHE = "mashup-models-v1";
export const MODEL_RATE = 44100;

/** The export takes exactly this many samples (7.8 s) per run. */
export const SEGMENT_SAMPLES = 343980;
const STRIDE = Math.floor(SEGMENT_SAMPLES * 0.75);
const FADE = Math.floor(STRIDE / 2);

/** Start offsets of segments covering `total` samples, overlapping by a quarter, none wasted past the end. */
export function segmentStarts(total: number): number[] {
  const starts = [0];
  while (starts[starts.length - 1] + SEGMENT_SAMPLES < total) starts.push(starts[starts.length - 1] + STRIDE);
  return starts;
}

/** Weight of sample `i` of a segment: linear fades where segments overlap, flat at the song's own edges. */
export function segmentWeight(i: number, length: number, first: boolean, last: boolean) {
  const fadeIn = first ? 1 : Math.min(1, (i + 1) / FADE);
  const fadeOut = last ? 1 : Math.min(1, (length - i) / FADE);
  return Math.min(fadeIn, fadeOut);
}

/** Sums weighted segments into whole-song channels, then normalises by the total weight. */
export class OverlapAdd {
  readonly channels: Float32Array[];
  private readonly weights: Float32Array;

  constructor(length: number, channelCount: number) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(length));
    this.weights = new Float32Array(length);
  }

  add(start: number, segment: Float32Array[], length: number, first: boolean, last: boolean) {
    for (let i = 0; i < length; i++) {
      const w = segmentWeight(i, length, first, last);
      this.channels.forEach((out, c) => (out[start + i] += segment[c][i] * w));
      this.weights[start + i] += w;
    }
  }

  finish(): Float32Array[] {
    for (const out of this.channels) for (let i = 0; i < out.length; i++) if (this.weights[i] > 0) out[i] /= this.weights[i];
    return this.channels;
  }
}
