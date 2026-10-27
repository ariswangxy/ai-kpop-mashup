import { describe, expect, it } from "vitest";
import { timeStretch } from "./stretch";
import { alignmentOffset, beatPhase, detectBpm, estimateBpm, matchTempo, onsetEnvelope } from "./tempo";

const SR = 22050;

/** Short decaying noise bursts every beat, starting at `offsetSec`. */
function clickTrack(bpm: number, seconds: number, offsetSec = 0) {
  const data = new Float32Array(seconds * SR);
  const beat = (60 / bpm) * SR;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = offsetSec * SR; t < data.length; t += beat) {
    for (let i = 0; i < 800 && t + i < data.length; i++) data[Math.round(t) + i] = noise() * Math.exp(-i / 150);
  }
  return data;
}

function zeroCrossingsPerSec(data: Float32Array) {
  let n = 0;
  for (let i = 1; i < data.length; i++) if ((data[i - 1] < 0) !== (data[i] < 0)) n++;
  return (n / data.length) * SR;
}

describe("estimateBpm", () => {
  it.each([75, 90, 100, 112, 128, 140, 155])("finds %i BPM in a click track", (bpm) => {
    const est = estimateBpm(onsetEnvelope([clickTrack(bpm, 30)], SR));
    expect(est).not.toBeNull();
    expect(Math.abs(est! - bpm)).toBeLessThan(1.5);
  });

  it("may report very fast tempos at half time", () => {
    const est = estimateBpm(onsetEnvelope([clickTrack(172, 30)], SR))!;
    expect(Math.min(Math.abs(est - 172), Math.abs(est * 2 - 172))).toBeLessThan(1.5);
  });

  it("isn't fooled by a syncopated 3-3-2 kick into reporting 2/3 of the tempo", () => {
    // Jersey club / dembow style at 150 BPM: kicks on eighths 1, 4 and 7 of each bar, so they
    // repeat every 1.5 beats (= 100 BPM), plus quieter hi-hats on every eighth.
    const bpm = 150;
    const eighth = (60 / bpm / 2) * SR;
    const data = new Float32Array(30 * SR);
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let e = 0; e * eighth < data.length; e++) {
      const kick = [0, 3, 6].includes(e % 8);
      const [gain, decay] = kick ? [1, 400] : [0.3, 60];
      const t = Math.round(e * eighth);
      for (let i = 0; i < 1200 && t + i < data.length; i++) data[t + i] += gain * noise() * Math.exp(-i / decay);
    }
    const est = estimateBpm(onsetEnvelope([data], SR))!;
    expect(Math.min(Math.abs(est - bpm), Math.abs(est * 2 - bpm))).toBeLessThan(1.5);
  });

  it("returns null for silence", () => {
    expect(estimateBpm(onsetEnvelope([new Float32Array(30 * SR)], SR))).toBeNull();
  });

  it.each([128.37, 87.2, 173.3, 96.55])("is precise enough not to drift at %f BPM", (bpm) => {
    const data = clickTrack(bpm, 90);
    const est = detectBpm({ sampleRate: SR, numberOfChannels: 1, duration: 90, getChannelData: () => data })!;
    // Treat half/double time as the same tempo; what matters is drift over a 30 s mashup.
    const ratio = [est / bpm, (est * 2) / bpm, est / 2 / bpm].reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
    const driftMs = Math.abs(ratio - 1) * 30 * 1000;
    expect(driftMs).toBeLessThan(20);
  });
});

describe("beatPhase", () => {
  it("finds where the beat grid starts", () => {
    const phase = beatPhase(onsetEnvelope([clickTrack(120, 20, 0.2)], SR), 120);
    expect(phase).toBeCloseTo(0.2, 1);
  });
});

describe("matchTempo", () => {
  it("stretches by the tempo ratio", () => {
    const m = matchTempo(120, 126);
    expect(m.speed).toBeCloseTo(1.05);
    expect(m.inRange).toBe(true);
  });

  it("uses half or double time when closer", () => {
    expect(matchTempo(70, 140)).toMatchObject({ speed: 1, sourceBpm: 140 });
    expect(matchTempo(160, 82).sourceBpm).toBe(80);
  });

  it("flags pairs too far apart", () => {
    expect(matchTempo(100, 135).inRange).toBe(false);
  });
});

describe("alignmentOffset", () => {
  it("returns the smallest shift that lines up the beats", () => {
    // Beat is 0.5 s. A's beat at 0.1 s, B's at 0.3 s: delay vocals by 0.2 s.
    expect(alignmentOffset(0.1, 0.3, 1, 120)).toBeCloseTo(0.2);
    // A at 0.4, B at 0.05: the next B beat is 0.15 s after A's, so delay by 0.15 s.
    expect(alignmentOffset(0.4, 0.05, 1, 120)).toBeCloseTo(0.15);
    expect(alignmentOffset(0.05, 0.4, 1, 120)).toBeCloseTo(-0.15);
  });
});

describe("timeStretch", () => {
  it.each([0.8, 1.1, 1.25])("changes length by 1/speed and keeps pitch at speed %f", (speed) => {
    const input = new Float32Array(SR * 4).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
    const out = timeStretch(input, SR, speed);
    expect(out.length).toBe(Math.floor(input.length / speed));
    const inner = out.subarray(SR / 2, out.length - SR / 2);
    expect(zeroCrossingsPerSec(inner)).toBeCloseTo(880, -1);
  });
});
