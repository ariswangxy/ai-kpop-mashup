import { describe, expect, it } from "vitest";
import { findChorus } from "./chorus";

const SR = 22050;
const NOTE = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 };
type Chord = (keyof typeof NOTE)[];
const CHORDS: Record<string, Chord> = {
  C: ["C", "E", "G"],
  F: ["F", "A", "C"],
  G: ["G", "B", "D"],
  Am: ["A", "C", "E"],
  Em: ["E", "G", "B"],
  Dm: ["D", "F", "A"],
};

interface Section {
  seconds: number;
  chords: string[]; // one chord per 2 s, looped
  gain: number;
}

/** Render chord pads (with a few harmonics) plus a kick on every beat at 120 BPM. */
function renderSong(sections: Section[]) {
  const total = sections.reduce((s, x) => s + x.seconds, 0);
  const out = new Float32Array(total * SR);
  let offset = 0;
  for (const section of sections) {
    const n = section.seconds * SR;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const chord = CHORDS[section.chords[Math.floor(t / 2) % section.chords.length]];
      let v = 0;
      for (const note of chord) {
        const f = NOTE[note];
        v += Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * f * 0.5 * t);
      }
      const beat = t % 0.5;
      const kick = beat < 0.1 ? Math.sin(2 * Math.PI * 60 * beat) * Math.exp(-beat * 30) : 0;
      out[offset + i] = section.gain * (v / 6 + kick * 0.6);
    }
    offset += n;
  }
  return out;
}

describe("findChorus", () => {
  it("picks the loud repeated section, not the quieter repeated verse", () => {
    const verse = { seconds: 30, chords: ["Am", "F", "C", "G"], gain: 0.4 };
    const chorus = { seconds: 30, chords: ["F", "G", "Em", "Am"], gain: 0.9 };
    const song = renderSong([
      { seconds: 10, chords: ["C"], gain: 0.2 }, // intro 0–10
      verse, // 10–40
      chorus, // 40–70
      verse, // 70–100
      chorus, // 100–130
      { seconds: 20, chords: ["Dm", "Em"], gain: 0.6 }, // bridge 130–150
      chorus, // 150–180
    ]);
    const result = findChorus([song], SR, 30);
    expect(result).not.toBeNull();
    const nearest = Math.min(...[40, 100, 150].map((c) => Math.abs(result!.startSec - c)));
    expect(nearest).toBeLessThan(1.5);
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it("prefers a repeated chorus over a louder section that only happens once", () => {
    const verse = { seconds: 25, chords: ["Am", "F", "C", "G"], gain: 0.4 };
    const chorus = { seconds: 30, chords: ["F", "G", "Em", "Am"], gain: 0.7 };
    const song = renderSong([
      verse, // 0–25
      chorus, // 25–55
      verse, // 55–80
      chorus, // 80–110
      { seconds: 30, chords: ["Dm", "C", "Em", "G"], gain: 1 }, // loud one-off breakdown 110–140
      chorus, // 140–170
    ]);
    const result = findChorus([song], SR, 30)!;
    const nearest = Math.min(...[25, 80, 140].map((c) => Math.abs(result.startSec - c)));
    expect(nearest).toBeLessThan(1.5);
  });

  it("returns null for a track too short to have a repeat", () => {
    expect(findChorus([new Float32Array(30 * SR)], SR, 30)).toBeNull();
  });
});
