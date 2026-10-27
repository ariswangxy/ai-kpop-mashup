import { describe, expect, it } from "vitest";
import {
  BEAT_RATE,
  CHUNK_FRAMES,
  chunkAt,
  chunkStarts,
  deduplicatePeaks,
  FPS,
  logitsToBeats,
  logMelSpectrogram,
  melFilterbank,
  placeChunk,
} from "./beat-this";

describe("logMelSpectrogram", () => {
  it("gives one frame per 20 ms, centred, with 128 mel bands", () => {
    const { data, frames } = logMelSpectrogram(new Float32Array(BEAT_RATE * 2));
    expect(frames).toBe(Math.floor((BEAT_RATE * 2) / 441) + 1);
    expect(data).toHaveLength(frames * 128);
  });

  it("puts a 1 kHz tone in the mel band that covers 1 kHz", () => {
    const tone = Float32Array.from({ length: BEAT_RATE }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / BEAT_RATE));
    const { data } = logMelSpectrogram(tone);
    const row = data.subarray(20 * 128, 21 * 128);
    const loudest = row.indexOf(Math.max(...row));
    const bank = melFilterbank();
    const bin = Math.round((1000 / (BEAT_RATE / 2)) * 512);
    expect(bank[bin][loudest]).toBeGreaterThan(0.5);
  });
});

describe("chunks", () => {
  it.each([500, 1488, 1500, 4000, 10050])("cover every frame of a %i-frame song with trusted predictions", (frames) => {
    const spect = { data: new Float32Array(frames * 128).fill(1), frames };
    const song = new Float32Array(frames).fill(NaN);
    for (const start of chunkStarts(frames).reverse()) {
      const chunk = chunkAt(spect, start);
      expect(chunk.frames).toBeLessThanOrEqual(CHUNK_FRAMES);
      placeChunk(song, start, new Float32Array(chunk.frames).fill(start));
    }
    expect(song.every((v) => !Number.isNaN(v))).toBe(true);
  });

  it("zero-pads before the start of the song", () => {
    const spect = { data: new Float32Array(3000 * 128).fill(1), frames: 3000 };
    const first = chunkAt(spect, chunkStarts(3000)[0]);
    expect(first.data[0]).toBe(0);
    expect(first.data[6 * 128]).toBe(1);
  });
});

describe("logitsToBeats", () => {
  it("merges adjacent peak frames into their average, like beat_this", () => {
    expect(deduplicatePeaks([3, 4, 10, 11, 12])).toEqual([3.5, 10.5, 12]);
    // Each frame is compared with the running average, as in beat_this: 5 is 1.5 from 3.5.
    expect(deduplicatePeaks([3, 4, 5, 10])).toEqual([3.5, 5, 10]);
    expect(deduplicatePeaks([])).toEqual([]);
  });

  it("picks confident local maxima and snaps bar starts onto beats", () => {
    const beat = new Float32Array(400).fill(-5);
    const downbeat = new Float32Array(400).fill(-5);
    for (let f = 10; f < 400; f += 25) beat[f] = 3; // 120 BPM
    downbeat[61] = 2; // one frame after the beat at frame 60
    beat[200] = -0.5; // a weak beat (probability < 0.5) is dropped
    const { beats, downbeats } = logitsToBeats(beat, downbeat);
    expect(beats[0]).toBeCloseTo(10 / FPS);
    expect(beats).not.toContain(200 / FPS);
    expect(downbeats).toEqual([60 / FPS]);
  });
});
