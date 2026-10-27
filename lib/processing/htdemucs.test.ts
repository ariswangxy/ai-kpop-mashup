import { describe, expect, it } from "vitest";
import { OverlapAdd, SEGMENT_SAMPLES, segmentStarts, segmentWeight } from "./htdemucs";

describe("segmentStarts", () => {
  it("uses one segment for audio that fits in one", () => {
    expect(segmentStarts(1000)).toEqual([0]);
    expect(segmentStarts(SEGMENT_SAMPLES)).toEqual([0]);
  });

  it("covers the whole song with no segment starting past what's needed", () => {
    for (const total of [SEGMENT_SAMPLES + 1, 30 * 44100, 201 * 44100]) {
      const starts = segmentStarts(total);
      const lastStart = starts[starts.length - 1];
      expect(lastStart + SEGMENT_SAMPLES).toBeGreaterThanOrEqual(total);
      // The previous segment must not already have reached the end.
      expect(starts[starts.length - 2] + SEGMENT_SAMPLES).toBeLessThan(total);
    }
  });

  it("needs 5 segments for 30 s at 44.1 kHz (demucs-web ran 6)", () => {
    expect(segmentStarts(30 * 44100)).toHaveLength(5);
  });
});

describe("OverlapAdd", () => {
  it("reconstructs a signal exactly when every segment returns it unchanged", () => {
    const total = 30 * 44100;
    const signal = Float32Array.from({ length: total }, (_, i) => Math.sin(i / 50));
    const blend = new OverlapAdd(total, 1);
    const starts = segmentStarts(total);
    starts.forEach((start, n) => {
      const length = Math.min(SEGMENT_SAMPLES, total - start);
      blend.add(start, [signal.subarray(start, start + length)], length, n === 0, n === starts.length - 1);
    });
    const [out] = blend.finish();
    let maxError = 0;
    for (let i = 0; i < total; i++) maxError = Math.max(maxError, Math.abs(out[i] - signal[i]));
    expect(maxError).toBeLessThan(1e-5);
  });

  it("keeps the song's first and last samples at full weight", () => {
    expect(segmentWeight(0, SEGMENT_SAMPLES, true, false)).toBe(1);
    expect(segmentWeight(SEGMENT_SAMPLES - 1, SEGMENT_SAMPLES, false, true)).toBe(1);
    expect(segmentWeight(0, SEGMENT_SAMPLES, false, false)).toBeGreaterThan(0);
  });
});
