/**
 * Web Worker that runs beat_this (see beat-this.ts) with ONNX Runtime Web: mono audio at 22.05 kHz
 * in, beat and downbeat times out. Requests run one at a time, since a session runs one job at once.
 */
import * as ort from "onnxruntime-web/webgpu";
import { BEAT_MODEL_URL, chunkAt, chunkStarts, logitsToBeats, logMelSpectrogram, placeChunk } from "./beat-this";

export type BeatsRequest = { id: number; signal: Float32Array };
export type BeatsReply =
  | { id: number; type: "done"; beats: number[]; downbeats: number[] }
  | { id: number; type: "error"; message: string };

let session: Promise<ort.InferenceSession> | null = null;
let queue = Promise.resolve();

function loadSession() {
  session ??= ort.InferenceSession.create(BEAT_MODEL_URL, { executionProviders: ["webgpu", "wasm"] });
  session.catch(() => (session = null)); // let a later song retry
  return session;
}

async function findBeats(signal: Float32Array) {
  const model = await loadSession();
  const spect = logMelSpectrogram(signal);
  const beat = new Float32Array(spect.frames).fill(-1000);
  const downbeat = new Float32Array(spect.frames).fill(-1000);
  // Reverse order, so where chunks overlap the earlier one's prediction is kept.
  for (const start of chunkStarts(spect.frames).reverse()) {
    const chunk = chunkAt(spect, start);
    const out = await model.run({ spect: new ort.Tensor("float32", chunk.data, [1, chunk.frames, 128]) });
    placeChunk(beat, start, out.beat.data as Float32Array);
    placeChunk(downbeat, start, out.downbeat.data as Float32Array);
  }
  return logitsToBeats(beat, downbeat);
}

self.onmessage = ({ data }: MessageEvent<BeatsRequest>) => {
  const post = (reply: BeatsReply) => (self as unknown as Worker).postMessage(reply);
  queue = queue.then(() =>
    findBeats(data.signal).then(
      (found) => post({ id: data.id, type: "done", ...found }),
      (e) => post({ id: data.id, type: "error", message: e instanceof Error ? e.message : String(e) }),
    ),
  );
};
