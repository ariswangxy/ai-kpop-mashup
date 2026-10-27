/**
 * Mixing, plus a fallback stem approximation for when no AI separator is running.
 * The approximations are classic pre-AI tricks, not real source separation:
 * - Vocals: the mid (center) channel, band-limited to the voice range.
 * - Instrumental: the side channel (L−R cancels center-panned vocals) plus low bass from the mid.
 * Mono input has no side channel, so the instrumental falls back to the mid with the vocal band cut.
 */

import { stretchAndShift } from "./stretch";

export interface ChannelSlice {
  sampleRate: number;
  channels: Float32Array[];
}

interface ChannelSource {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** Copy `durationSec` of audio starting at `startSec`, zero-padding past the end. */
export function sliceChannels(source: ChannelSource, startSec: number, durationSec: number): ChannelSlice {
  const { sampleRate } = source;
  const start = Math.max(0, Math.round(startSec * sampleRate));
  const length = Math.round(durationSec * sampleRate);
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => {
    const out = new Float32Array(length);
    out.set(source.getChannelData(c).subarray(start, start + length));
    return out;
  });
  return { sampleRate, channels };
}

/** Split into mid (L+R)/2 and side (L−R)/2. Mono input yields a silent side and `isMono: true`. */
export function midSide(slice: ChannelSlice) {
  const [left, right] = slice.channels;
  if (!right) return { mid: left.slice(), side: new Float32Array(left.length), isMono: true };
  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i] + right[i]) / 2;
    side[i] = (left[i] - right[i]) / 2;
  }
  return { mid, side, isMono: false };
}

/** Linear fade-in and fade-out applied in place to every channel. */
export function applyFades(channels: Float32Array[], sampleRate: number, fadeSec: number) {
  for (const data of channels) {
    const n = Math.min(Math.round(fadeSec * sampleRate), Math.floor(data.length / 2));
    if (n === 0) continue;
    for (let i = 0; i < n; i++) {
      const g = i / n;
      data[i] *= g;
      data[data.length - 1 - i] *= g;
    }
  }
}

export interface MixOptions {
  vocals: ChannelSlice; // slice of Song A
  instrumental: ChannelSlice; // slice of Song B
  vocalGain: number;
  instGain: number;
  durationSec: number;
  fadeSec: number;
  sampleRate?: number;
  /** Time-stretch the vocals by this speed (pitch kept). The vocal slice should be durationSec × speed long. */
  vocalSpeed?: number;
  /** Shift the vocals later (positive) or earlier (negative) to line up beats. */
  vocalOffsetSec?: number;
  /** Transpose the vocals by this many semitones (timing kept). */
  vocalSemitones?: number;
  /** True when `vocals` and `instrumental` are already clean AI stems: mix them as they are. */
  separated?: boolean;
}

/** Render vocals-of-A over instrumental-of-B into a stereo AudioBuffer. Browser only. */
export async function renderMashup(opts: MixOptions): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const ctx = new OfflineAudioContext(2, Math.round(opts.durationSec * sampleRate), sampleRate);

  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(ctx.destination);

  const source = (channels: Float32Array[], rate: number) => {
    const buf = ctx.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((data, c) => buf.getChannelData(c).set(data));
    const node = ctx.createBufferSource();
    node.buffer = buf;
    return node;
  };
  const filter = (type: BiquadFilterType, frequency: number, Q = 0.707, gain = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  };
  const gain = (value: number) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };

  const speed = opts.vocalSpeed ?? 1;
  const semitones = opts.vocalSemitones ?? 0;
  const offset = opts.vocalOffsetSec ?? 0;
  const startVocals = (node: AudioBufferSourceNode) => (offset >= 0 ? node.start(offset) : node.start(0, -offset));
  const vocalRate = opts.vocals.sampleRate;
  const instRate = opts.instrumental.sampleRate;

  if (opts.separated) {
    // Clean stems: keep the vocals' stereo image and the full instrumental.
    const vocals = stretchAndShift(opts.vocals.channels, vocalRate, speed, semitones);
    const vocalSrc = source(vocals, vocalRate);
    vocalSrc.connect(gain(opts.vocalGain)).connect(master);
    startVocals(vocalSrc);

    const instSrc = source(opts.instrumental.channels, instRate);
    instSrc.connect(gain(opts.instGain)).connect(master);
    instSrc.start();
  } else {
    // Vocals from Song A: center channel, voice band, a touch of presence.
    const a = midSide(opts.vocals);
    const vocalSrc = source(stretchAndShift([a.mid], vocalRate, speed, semitones), vocalRate);
    vocalSrc
      .connect(filter("highpass", 180))
      .connect(filter("lowpass", 6000))
      .connect(filter("peaking", 3000, 1, 3))
      .connect(gain(opts.vocalGain * 1.4))
      .connect(master);
    startVocals(vocalSrc);

    // Instrumental from Song B.
    const b = midSide(opts.instrumental);
    if (b.isMono) {
      const src = source([b.mid], instRate);
      src.connect(filter("peaking", 1500, 0.6, -12)).connect(gain(opts.instGain)).connect(master);
      src.start();
    } else {
      const inverted = b.side.map((v) => -v);
      const sideSrc = source([b.side, inverted], instRate);
      sideSrc.connect(gain(opts.instGain * 1.6)).connect(master);
      sideSrc.start();

      const bassSrc = source([b.mid], instRate);
      bassSrc.connect(filter("lowpass", 160)).connect(gain(opts.instGain)).connect(master);
      bassSrc.start();
    }
  }

  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, c) => rendered.getChannelData(c));
  applyFades(channels, sampleRate, opts.fadeSec);
  return rendered;
}
