import type { BeatsReply, BeatsRequest } from "./beats-worker";
import { BEAT_RATE } from "./beat-this";
import type { AiBeats } from "./demucs";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (reply: BeatsReply) => void>();

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL("./beats-worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<BeatsReply>) => {
    pending.get(data.id)?.(data);
    pending.delete(data.id);
    // Free its memory (an ONNX Runtime instance and the model) before separation needs it; the
    // next song starts a fresh worker in a second or two, with the model file from the HTTP cache.
    if (pending.size === 0 && worker === w) {
      w.terminate();
      worker = null;
    }
  };
  w.onerror = (e) => {
    for (const [id, resolve] of pending) resolve({ id, type: "error", message: e.message || "the worker crashed" });
    pending.clear();
    w.terminate();
    worker = null;
  };
  return (worker = w);
}

/**
 * Beats and bar starts for a whole song from beat_this running in this browser (beats-worker.ts),
 * for when the local AI service isn't running. Null if it fails; the in-browser estimate stays.
 */
export async function findBeatsInBrowser(buffer: AudioBuffer): Promise<AiBeats | null> {
  try {
    const signal = await monoAt(buffer, BEAT_RATE);
    const reply = await new Promise<BeatsReply>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      getWorker().postMessage({ id, signal } satisfies BeatsRequest, [signal.buffer]);
    });
    if (reply.type === "error") {
      console.warn(`In-browser beat tracking failed: ${reply.message}`);
      return null;
    }
    return reply.beats.length > 8 ? { beats: reply.beats, downbeats: reply.downbeats } : null;
  } catch (e) {
    console.warn("In-browser beat tracking failed:", e);
    return null;
  }
}

/** The song mixed down to mono and resampled, by the browser's own resampler. */
async function monoAt(buffer: AudioBuffer, rate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  // A copy: an AudioBuffer's own memory can't always be transferred to a worker.
  return (await ctx.startRendering()).getChannelData(0).slice();
}
