/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 * Cuts the input into overlapping 40 ms grains and re-spaces them, nudging each grain
 * by up to 8 ms so its waveform lines up with the previous one and doesn't phase-click.
 */
export function timeStretch(input: Float32Array, sampleRate: number, speed: number): Float32Array {
  return timeStretchChannels([input], sampleRate, speed)[0];
}

/**
 * Change speed by `speed` and pitch by `semitones` independently. Pitch shifting is resampling
 * (which changes pitch and length together) followed by a time stretch that restores the length.
 * Large shifts also move the voice's formants, so it starts to sound higher/lower-voiced.
 */
export function stretchAndShift(
  channels: Float32Array[],
  sampleRate: number,
  speed: number,
  semitones: number,
): Float32Array[] {
  if (!semitones) return timeStretchChannels(channels, sampleRate, speed);
  const ratio = 2 ** (semitones / 12);
  return timeStretchChannels(
    channels.map((c) => resample(c, ratio)),
    sampleRate,
    speed / ratio,
  );
}

/** Read the input `ratio` times faster (linear interpolation): >1 raises pitch and shortens it. */
export function resample(input: Float32Array, ratio: number): Float32Array {
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const frac = x - j;
    out[i] = input[j] * (1 - frac) + (input[j + 1] ?? input[j]) * frac;
  }
  return out;
}

/**
 * Stretch several channels identically: grain positions are chosen on the channel average and
 * applied to every channel, so the stereo image stays intact.
 */
export function timeStretchChannels(channels: Float32Array[], sampleRate: number, speed: number): Float32Array[] {
  const length = channels[0].length;
  const outLen = Math.floor(length / speed);
  if (Math.abs(speed - 1) < 1e-3) return channels.map((c) => c.slice(0, outLen));

  const guide =
    channels.length === 1
      ? channels[0]
      : channels[0].map((_, i) => channels.reduce((s, c) => s + c[i], 0) / channels.length);

  const frame = 2 * Math.round(sampleRate * 0.02);
  const hop = frame / 2;
  const tolerance = Math.round(sampleRate * 0.008);
  const window = new Float32Array(frame).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame));
  const outs = channels.map(() => new Float32Array(outLen + frame));
  const lastStart = length - frame;

  // Normalised similarity between the grain at `p` and the natural continuation at `ref`, on every 4th sample.
  const similarity = (p: number, ref: number) => {
    let dot = 0;
    let energy = 1e-9;
    for (let i = 0; i < hop; i += 4) {
      dot += guide[p + i] * guide[ref + i];
      energy += guide[p + i] * guide[p + i];
    }
    return dot / Math.sqrt(energy);
  };

  let prev = 0;
  for (let outPos = 0; outPos < outLen; outPos += hop) {
    let pos = Math.min(Math.round(outPos * speed), lastStart);
    const ref = prev + hop;
    if (outPos > 0 && ref + hop <= length && pos > 0) {
      const lo = Math.max(0, pos - tolerance);
      const hi = Math.min(lastStart, pos + tolerance);
      // Coarse search, then refine around the best coarse match.
      let best = pos;
      let bestScore = -Infinity;
      for (let p = lo; p <= hi; p += 4) {
        const s = similarity(p, ref);
        if (s > bestScore) [bestScore, best] = [s, p];
      }
      for (let p = Math.max(lo, best - 3); p <= Math.min(hi, best + 3); p++) {
        const s = similarity(p, ref);
        if (s > bestScore) [bestScore, best] = [s, p];
      }
      pos = best;
    }
    pos = Math.max(0, pos);
    channels.forEach((input, c) => {
      const out = outs[c];
      for (let i = 0; i < frame; i++) out[outPos + i] += (input[pos + i] ?? 0) * window[i];
    });
    prev = pos;
  }
  return outs.map((o) => o.slice(0, outLen));
}
