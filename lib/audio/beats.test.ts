import { describe, expect, it } from "vitest";
import { analyzeBeats, beatInBar, nearestDownbeat, shiftBarStarts, stepBeats } from "./beats";

const SR = 22050;
const BPM = 120;
const BEAT = 60 / BPM;
const INTRO = 4.37; // silence, then the first bar starts here
// Chord roots per bar (pitch classes): C, A, F, G.
const CHORDS = [
  [0, 4, 7],
  [9, 0, 4],
  [5, 9, 0],
  [7, 11, 2],
];

/** 4/4 pop groove: kick on 1 and 3, snare on 2 and 4, chord changes on every bar's beat 1. */
function song(seconds: number) {
  const out = new Float32Array(seconds * SR);
  let seed = 9;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = Math.round(INTRO * SR); i < out.length; i++) {
    const t = i / SR - INTRO;
    const beat = Math.floor(t / BEAT);
    const inBeat = t - beat * BEAT;
    const bar = Math.floor(beat / 4);
    let v = 0;
    for (const pc of CHORDS[bar % 4]) v += 0.15 * Math.sin(2 * Math.PI * 261.63 * 2 ** (pc / 12) * t);
    if (beat % 2 === 0 && inBeat < 0.15) v += Math.sin(2 * Math.PI * 55 * inBeat) * Math.exp(-inBeat * 25); // kick
    if (beat % 2 === 1 && inBeat < 0.08) v += 0.5 * noise() * Math.exp(-inBeat * 60); // snare
    out[i] = v * 0.6;
  }
  return out;
}

const data = song(60);
const info = analyzeBeats([data], SR, BPM);
const downbeat = (bar: number) => INTRO + bar * 4 * BEAT;

describe("analyzeBeats", () => {
  it("puts beats on the groove", () => {
    const within = Array.from(info.times).filter((t) => t > INTRO + 1);
    for (const t of within.slice(0, 40)) {
      const off = (((t - INTRO) % BEAT) + BEAT) % BEAT;
      expect(Math.min(off, BEAT - off)).toBeLessThan(0.02);
    }
  });

  it("knows which beat of the bar it is", () => {
    expect(beatInBar(info, downbeat(5))).toBe(1);
    expect(beatInBar(info, downbeat(5) + BEAT)).toBe(2);
    expect(beatInBar(info, downbeat(5) + 2 * BEAT)).toBe(3); // also a kick: chord changes tell it apart
    expect(beatInBar(info, downbeat(12) + 3 * BEAT)).toBe(4);
  });

  it("snaps to the nearest bar start", () => {
    expect(nearestDownbeat(info, downbeat(7) + 0.6)).toBeCloseTo(downbeat(7), 1);
    expect(Math.abs(nearestDownbeat(info, downbeat(7) + 1.4) - downbeat(8))).toBeLessThan(0.02);
  });

  it("steps by beats", () => {
    expect(Math.abs(stepBeats(info, downbeat(3), 1) - (downbeat(3) + BEAT))).toBeLessThan(0.02);
    expect(Math.abs(stepBeats(info, downbeat(3), -4) - downbeat(2))).toBeLessThan(0.02);
  });
});

describe("shiftBarStarts", () => {
  // 32 beats at 120 BPM with beat 1 of each bar on beats 0, 4, 8, …
  const times = Float32Array.from({ length: 32 }, (_, i) => i * BEAT);
  const info = { times, barStart: times.map((_, i) => (i % 4 === 0 ? 1 : 0)), strength: times.map(() => 1) };

  it("moves beat 1 later or earlier by whole beats", () => {
    const later = shiftBarStarts(info, 1);
    expect(beatInBar(later, times[9])).toBe(1);
    expect(nearestDownbeat(later, times[8])).toBeCloseTo(times[9]);
    const earlier = shiftBarStarts(info, -1);
    expect(beatInBar(earlier, times[7])).toBe(1);
  });

  it("is undone by the opposite shift and leaves the input alone", () => {
    const back = shiftBarStarts(shiftBarStarts(info, 3), -3);
    expect(beatInBar(back, times[16])).toBe(1);
    expect(beatInBar(info, times[16])).toBe(1);
  });
});
