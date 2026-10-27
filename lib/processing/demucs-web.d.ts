// demucs-web (MIT) ships plain JS. These are the helpers browser-worker.ts uses.
declare module "demucs-web" {
  interface TrackSpec {
    leftReal: Float32Array;
    leftImag: Float32Array;
    rightReal: Float32Array;
    rightImag: Float32Array;
  }
  /** STFT of one segment (zero-padded to the model's length) as the model's two inputs. */
  export function prepareModelInput(
    left: Float32Array,
    right: Float32Array,
  ): { waveform: Float32Array; magSpec: Float32Array; numBins: number; numFrames: number };
  /** The frequency branch's output as one complex spectrogram per source. */
  export function standaloneMask(freqOutput: ArrayLike<number>): TrackSpec[];
  /** Inverse STFT of one source back to `targetLength` samples. */
  export function standaloneIspec(spec: TrackSpec, targetLength: number): { left: Float32Array; right: Float32Array };
}
