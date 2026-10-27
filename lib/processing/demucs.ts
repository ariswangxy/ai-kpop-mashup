import { getAudioContext } from "@/lib/audio/decode";
import type { ChannelSlice } from "@/lib/audio/dsp";
import { encodeWav } from "@/lib/audio/wav";
import { runMashup, type Separator } from "./pipeline";
import type { MashupProcessor } from "./types";

/** Sends a section to the local Demucs service (via /api/separate) and decodes the stem it returns. */
const separateOnce: Separator = async (slice, keep, signal) => {
  const wav = encodeWav({
    numberOfChannels: slice.channels.length,
    sampleRate: slice.sampleRate,
    length: slice.channels[0].length,
    getChannelData: (c) => slice.channels[c],
  });
  const res = await fetch(`/api/separate?keep=${keep}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
    signal,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `The AI separator failed (HTTP ${res.status}).`);
  }
  const buffer = await getAudioContext().decodeAudioData(await res.arrayBuffer());
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  return { sampleRate: buffer.sampleRate, channels } satisfies ChannelSlice;
};

const CHUNK_SEC = 60;
const OVERLAP_SEC = 2;

/**
 * Full songs go in 60 s chunks, so each request stays small and progress can be shown. Chunks
 * overlap by 2 s on each side and are crossfaded, hiding the model's slightly weaker edges.
 */
const separateWithDemucs: Separator = async (slice, keep, signal, onFraction) => {
  const rate = slice.sampleRate;
  const total = slice.channels[0].length;
  const step = CHUNK_SEC * rate;
  const overlap = OVERLAP_SEC * rate;
  if (total <= step + 2 * overlap) return separateOnce(slice, keep, signal);

  const out = slice.channels.map(() => new Float32Array(total));
  const chunks = Math.ceil(total / step);
  onFraction?.(0);
  for (let i = 0; i < chunks; i++) {
    const from = Math.max(0, i * step - overlap);
    const to = Math.min(total, (i + 1) * step + overlap);
    const piece = await separateOnce({ sampleRate: rate, channels: slice.channels.map((c) => c.subarray(from, to)) }, keep, signal);
    const fade = 2 * overlap;
    for (let p = from; p < to; p++) {
      // Linear crossfade across each 4 s overlap; the two weights there sum to 1.
      let w = 1;
      if (from > 0 && p < from + fade) w = (p - from) / fade;
      if (to < total && p >= to - fade) w = Math.min(w, (to - p) / fade);
      out.forEach((channel, c) => (channel[p] += (piece.channels[c]?.[p - from] ?? 0) * w));
    }
    onFraction?.((i + 1) / chunks);
  }
  return { sampleRate: rate, channels: out };
};

export const demucsProcessor: MashupProcessor = {
  id: "demucs",
  label: "AI separation (Demucs)",
  process(input, onProgress, signal) {
    return runMashup(input, onProgress, signal, separateWithDemucs, this.id);
  },
};

export interface AiBeats {
  beats: number[];
  downbeats: number[];
}

/** Beats and bar starts for a whole song from the AI service (madmom), or null if it's unavailable. */
export async function findBeatsWithAi(buffer: AudioBuffer, signal?: AbortSignal): Promise<AiBeats | null> {
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  const wav = encodeWav({ numberOfChannels: 1, sampleRate: buffer.sampleRate, length: mono.length, getChannelData: () => mono });
  try {
    const res = await fetch("/api/beats", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, signal });
    if (!res.ok) return null;
    const result: AiBeats = await res.json();
    return result.beats.length > 8 ? result : null;
  } catch {
    return null;
  }
}

export interface SeparatorStatus {
  ok: boolean;
  /** False when the service is deployed without its AI models (the Vercel deployment, for now). */
  installed?: boolean;
  model?: string;
  device?: string;
}

/** Whether the local separator is up. Never throws. */
export async function checkSeparator(): Promise<SeparatorStatus> {
  try {
    const res = await fetch("/api/separate", { cache: "no-store" });
    return res.ok ? await res.json() : { ok: false };
  } catch {
    return { ok: false };
  }
}
