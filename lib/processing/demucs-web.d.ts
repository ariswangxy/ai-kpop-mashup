// demucs-web (MIT) ships plain JS. These are the helpers browser-worker.ts and beat-this.ts use.
declare module "demucs-web" {
  /** Short-time Fourier transform with a periodic Hann window, scaled by 1/sqrt(fftSize); no centring. */
  export function stft(
    signal: Float32Array,
    fftSize: number,
    hopSize: number,
  ): { real: Float32Array; imag: Float32Array; numFrames: number; numBins: number };
  /** Reflection padding, like torch's mode="reflect". */
  export function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array;
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
