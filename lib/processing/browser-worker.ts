/**
 * Web Worker that runs htdemucs with ONNX Runtime Web (WebGPU, falling back to WebAssembly), so
 * the page stays responsive while it works. Input and output are stereo at 44.1 kHz.
 *
 * Only the vocals are rebuilt from the model's output; the instrumental is the input minus the
 * vocals, as in separator/server.py.
 */
import * as ort from "onnxruntime-web/webgpu";
import { prepareModelInput, standaloneIspec, standaloneMask } from "demucs-web";
import { MODEL_BYTES, MODEL_CACHE, MODEL_URL, OverlapAdd, SEGMENT_SAMPLES, segmentStarts } from "./htdemucs";

export type WorkerRequest =
  | { type: "load" }
  | { type: "separate"; left: Float32Array; right: Float32Array; keep: "vocals" | "instrumental" };

export type WorkerMessage =
  | { type: "download"; fraction: number }
  | { type: "loaded" }
  | { type: "progress"; fraction: number }
  | { type: "done"; left: Float32Array; right: Float32Array }
  | { type: "error"; message: string };

const VOCALS = 3; // htdemucs sources: drums, bass, other, vocals
const BINS = 2048;
const FRAMES = 336;

const post = (message: WorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

let session: Promise<ort.InferenceSession> | null = null;

function loadSession() {
  session ??= modelBytes().then((bytes) =>
    ort.InferenceSession.create(bytes, { executionProviders: ["webgpu", "wasm"], graphOptimizationLevel: "basic" }),
  );
  session.catch(() => (session = null)); // let a later attempt retry
  return session;
}

/** The model from Cache Storage, downloading it (with progress) the first time. */
async function modelBytes(): Promise<Uint8Array> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null); // unavailable in some private windows
  const hit = await cache?.match(MODEL_URL);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the AI model (HTTP ${res.status}).`);
  const total = Number(res.headers.get("Content-Length")) || MODEL_BYTES;
  let bytes = new Uint8Array(total); // one buffer instead of chunks + a copy: the model is big
  const reader = res.body.getReader();
  let loaded = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (loaded + chunk.value.length > bytes.length) {
      const grown = new Uint8Array((loaded + chunk.value.length) * 2); // Content-Length was off
      grown.set(bytes);
      bytes = grown;
    }
    bytes.set(chunk.value, loaded);
    loaded += chunk.value.length;
    post({ type: "download", fraction: Math.min(1, loaded / total) });
  }
  bytes = bytes.subarray(0, loaded);
  await cache?.put(MODEL_URL, new Response(bytes)).catch(() => {}); // out of quota: just download next time
  return bytes;
}

async function separate(left: Float32Array, right: Float32Array, keep: "vocals" | "instrumental") {
  const model = await loadSession();
  const total = left.length;
  const starts = segmentStarts(total);
  const vocals = new OverlapAdd(total, 2);
  for (const [n, start] of starts.entries()) {
    const length = Math.min(SEGMENT_SAMPLES, total - start);
    const input = prepareModelInput(left.subarray(start, start + length), right.subarray(start, start + length));
    const out = await model.run({
      [model.inputNames[0]]: new ort.Tensor("float32", input.waveform, [1, 2, SEGMENT_SAMPLES]),
      [model.inputNames[1]]: new ort.Tensor("float32", input.magSpec, [1, 4, BINS, FRAMES]),
    });
    // htdemucs has two branches: a waveform [1, 4, 2, n] and a spectrogram [1, 4, 4, bins, frames].
    const outputs = model.outputNames.map((name) => out[name]);
    const time = outputs.find((t) => t.dims.length === 4)!.data as Float32Array;
    const freq = outputs.find((t) => t.dims.length === 5)!.data as Float32Array;
    const fromFreq = standaloneIspec(standaloneMask(freq)[VOCALS], SEGMENT_SAMPLES);
    const segment = [fromFreq.left, fromFreq.right].map((channel, c) => {
      const offset = (VOCALS * 2 + c) * SEGMENT_SAMPLES;
      for (let i = 0; i < length; i++) channel[i] += time[offset + i];
      return channel;
    });
    vocals.add(start, segment, length, n === 0, n === starts.length - 1);
    post({ type: "progress", fraction: (n + 1) / starts.length });
  }
  const [vl, vr] = vocals.finish();
  if (keep === "vocals") return [vl, vr];
  for (let i = 0; i < total; i++) {
    vl[i] = left[i] - vl[i];
    vr[i] = right[i] - vr[i];
  }
  return [vl, vr];
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === "load") {
      await loadSession();
      post({ type: "loaded" });
      return;
    }
    const [left, right] = await separate(data.left, data.right, data.keep);
    post({ type: "done", left, right }, [left.buffer, right.buffer]);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
