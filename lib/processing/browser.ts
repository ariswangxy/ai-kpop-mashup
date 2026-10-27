import type { WorkerMessage, WorkerRequest } from "./browser-worker";
import { MODEL_CACHE, MODEL_RATE, MODEL_URL } from "./htdemucs";
import { runMashup, type Separator } from "./pipeline";
import type { MashupProcessor } from "./types";

/**
 * Demucs running in this browser (browser-worker.ts), for when the local separator isn't
 * available, e.g. on the deployed site. The first run downloads the model; later runs use the cached copy.
 */
export const browserDemucsProcessor: MashupProcessor = {
  id: "browser-demucs",
  label: "AI separation (in your browser)",
  async process(input, onProgress, signal) {
    // Get the model ready before the mashup steps, so a first-time download shows as its own step.
    if (await modelCached()) await onProgress("prepare");
    await request({ type: "load" }, signal, (m) => m.type === "download" && onProgress("model", m.fraction));
    return runMashup(input, onProgress, signal, separateInBrowser, this.id);
  },
};

/** WebGPU is required: without it the model runs several times slower, too slow to be worth the download. */
export async function browserAiSupported(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** Whether the model is already downloaded. Never throws. */
export async function modelCached(): Promise<boolean> {
  try {
    return (await (await caches.open(MODEL_CACHE)).match(MODEL_URL)) !== undefined;
  } catch {
    return false;
  }
}

const separateInBrowser: Separator = async (slice, keep, signal, onFraction) => {
  const [left, right = left] = await resample(slice.channels, slice.sampleRate, MODEL_RATE);
  // Copies: transferring would empty arrays the pipeline (or an AudioBuffer) still owns.
  const l = left.slice();
  const r = right.slice();
  const done = await request(
    { type: "separate", left: l, right: r, keep },
    signal,
    (m) => m.type === "progress" && onFraction?.(m.fraction),
    [l.buffer, r.buffer],
  );
  if (done.type !== "done") throw new Error("The in-browser AI separator stopped unexpectedly.");
  return { sampleRate: slice.sampleRate, channels: await resample([done.left, done.right], MODEL_RATE, slice.sampleRate) };
};

let worker: Worker | null = null;

/** Sends one request to the worker and resolves with its final reply. Cancelling stops the worker outright. */
function request(
  message: WorkerRequest,
  signal: AbortSignal | undefined,
  onUpdate: (m: WorkerMessage) => void,
  transfer: Transferable[] = [],
): Promise<WorkerMessage> {
  signal?.throwIfAborted();
  worker ??= new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  return new Promise((resolve, reject) => {
    const stop = () => {
      w.terminate();
      if (worker === w) worker = null; // the next request starts a fresh one, with the model from cache
    };
    const onAbort = () => {
      stop();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const settle = () => {
      signal?.removeEventListener("abort", onAbort);
      w.onmessage = w.onerror = null;
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "error") {
        settle();
        reject(new Error(`In-browser AI separation failed: ${data.message}`));
      } else if (data.type === "loaded" || data.type === "done") {
        settle();
        resolve(data);
      } else {
        onUpdate(data);
      }
    };
    w.onerror = (e) => {
      settle();
      stop();
      reject(new Error(`In-browser AI separation failed: ${e.message || "the worker crashed"}`));
    };
    w.postMessage(message, transfer);
  });
}

/** Resamples with the browser's own resampler (OfflineAudioContext isn't available inside workers). */
async function resample(channels: Float32Array[], from: number, to: number): Promise<Float32Array[]> {
  if (from === to) return channels;
  const ctx = new OfflineAudioContext(channels.length, Math.round((channels[0].length * to) / from), to);
  const buffer = ctx.createBuffer(channels.length, channels[0].length, from);
  channels.forEach((channel, c) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const out = await ctx.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c));
}
