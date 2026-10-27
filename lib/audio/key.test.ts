import { describe, expect, it } from "vitest";
import { findKey, keyName, keyShiftBetween, transpose, type MusicalKey } from "./key";
import { stretchAndShift } from "./stretch";

const SR = 22050;
// Pitch classes, 0 = C.
const CHORDS: Record<string, number[]> = {
  C: [0, 4, 7], Dm: [2, 5, 9], Em: [4, 7, 11], F: [5, 9, 0], G: [7, 11, 2], Am: [9, 0, 4],
  D: [2, 6, 9], E: [4, 8, 11], Bm: [11, 2, 6],
};

/** Chord pads over a bass note, 2 s per chord, looped for `seconds`. */
function progression(chords: string[], seconds = 24) {
  const out = new Float32Array(seconds * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const notes = CHORDS[chords[Math.floor(t / 2) % chords.length]];
    let v = 0.6 * Math.sin(2 * Math.PI * 65.41 * 2 ** (notes[0] / 12) * t); // bass on the root
    for (const pc of notes) v += Math.sin(2 * Math.PI * 261.63 * 2 ** (pc / 12) * t);
    out[i] = v / 5;
  }
  return out;
}

const key = (tonic: number, mode: MusicalKey["mode"]): MusicalKey => ({ tonic, mode });

function zeroCrossingsPerSec(data: Float32Array) {
  let n = 0;
  for (let i = 1; i < data.length; i++) if ((data[i - 1] < 0) !== (data[i] < 0)) n++;
  return (n / data.length) * SR;
}

describe("findKey", () => {
  it.each([
    [["C", "F", "G", "C"], "C major"],
    [["G", "C", "D", "G"], "G major"],
    [["D", "G", "Bm", "D"], "D major"],
    [["Am", "Dm", "E", "Am"], "A minor"],
  ])("finds the key of %j", (chords, expected) => {
    expect(keyName(findKey([progression(chords)], SR)!)).toBe(expected);
  });

  it("returns null for silence", () => {
    expect(findKey([new Float32Array(10 * SR)], SR)).toBeNull();
  });
});

describe("keyShiftBetween", () => {
  it("takes the smallest shift into the same key", () => {
    expect(keyShiftBetween(key(0, "major"), key(2, "major"))).toBe(2); // C → D: up 2
    expect(keyShiftBetween(key(0, "major"), key(10, "major"))).toBe(-2); // C → B♭: down 2
    expect(keyShiftBetween(key(0, "major"), key(7, "major"))).toBe(-5); // C → G: down 5, not up 7
    expect(keyShiftBetween(key(0, "major"), key(6, "major"))).toBe(-6); // tritone: go down
    expect(keyShiftBetween(key(3, "minor"), key(8, "minor"))).toBe(5); // E♭ minor → A♭ minor
  });

  it("treats relative major and minor as the same key", () => {
    expect(keyShiftBetween(key(9, "minor"), key(0, "major"))).toBe(0); // A minor → C major
    expect(keyShiftBetween(key(9, "minor"), key(11, "minor"))).toBe(2); // A minor → B minor
  });

  it("lands on the target key", () => {
    const from = key(4, "minor");
    const to = key(7, "major"); // relative of E minor: no shift
    expect(transpose(from, keyShiftBetween(from, to))).toEqual(from);
  });
});

describe("stretchAndShift", () => {
  it.each([
    [2, 1],
    [-3, 1],
    [2, 1.1],
  ])("shifts by %i semitones at speed %f without changing the intended length", (semitones, speed) => {
    const input = new Float32Array(SR * 4).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
    const [out] = stretchAndShift([input], SR, speed, semitones);
    expect(Math.abs(out.length - input.length / speed)).toBeLessThan(2);
    const inner = out.subarray(SR / 2, out.length - SR / 2);
    const expected = 2 * 440 * 2 ** (semitones / 12);
    expect(Math.abs(zeroCrossingsPerSec(inner) - expected) / expected).toBeLessThan(0.02);
  });
});
