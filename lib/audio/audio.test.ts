import { describe, expect, it } from "vitest";
import { applyFades, midSide, sliceChannels } from "./dsp";
import { encodeWav, type PcmSource } from "./wav";

function fakeBuffer(channels: Float32Array[], sampleRate = 100): PcmSource {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    getChannelData: (c) => channels[c],
  };
}

describe("encodeWav", () => {
  it("writes a 16-bit PCM header and the right data size", () => {
    const buf = encodeWav(fakeBuffer([new Float32Array(10), new Float32Array(10)], 44100));
    const view = new DataView(buf);
    const ascii = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10 * 2 * 2);
    expect(buf.byteLength).toBe(44 + 40);
  });

  it("clips samples outside [-1, 1]", () => {
    const view = new DataView(encodeWav(fakeBuffer([Float32Array.from([2, -2])])));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

describe("sliceChannels", () => {
  it("returns exactly durationSec of audio and zero-pads past the end", () => {
    const src = fakeBuffer([Float32Array.from({ length: 300 }, () => 1)]);
    const slice = sliceChannels(src, 2.5, 1);
    expect(slice.channels[0].length).toBe(100);
    expect(slice.channels[0][49]).toBe(1);
    expect(slice.channels[0][50]).toBe(0);
  });
});

describe("midSide", () => {
  it("cancels a center-panned signal in the side channel", () => {
    const center = Float32Array.from([0.5, -0.25]);
    const { mid, side, isMono } = midSide({ sampleRate: 100, channels: [center, center.slice()] });
    expect(isMono).toBe(false);
    expect(Array.from(mid)).toEqual([0.5, -0.25]);
    expect(Array.from(side)).toEqual([0, 0]);
  });

  it("flags mono input", () => {
    expect(midSide({ sampleRate: 100, channels: [new Float32Array(4)] }).isMono).toBe(true);
  });
});

describe("applyFades", () => {
  it("starts and ends at silence and leaves the middle untouched", () => {
    const data = Float32Array.from({ length: 1000 }, () => 1);
    applyFades([data], 100, 1.5);
    expect(data[0]).toBe(0);
    expect(data[999]).toBe(0);
    expect(data[500]).toBe(1);
    expect(data[75]).toBeCloseTo(0.5);
  });
});
