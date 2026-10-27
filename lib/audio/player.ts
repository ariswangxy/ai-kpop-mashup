import { getAudioContext } from "./decode";

let current: { source: AudioBufferSourceNode; onEnd: () => void } | null = null;

/** Play a section of a buffer. Only one preview plays at a time; starting another stops the first. */
export async function playSection(buffer: AudioBuffer, offsetSec: number, durationSec: number, onEnd: () => void) {
  stopPlayback();
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const entry = { source, onEnd };
  source.onended = () => {
    if (current === entry) current = null;
    onEnd();
  };
  current = entry;
  source.start(0, offsetSec, durationSec);
}

export function stopPlayback() {
  if (!current) return;
  const { source } = current;
  current = null;
  try {
    source.stop();
  } catch {
    // already stopped
  }
}
