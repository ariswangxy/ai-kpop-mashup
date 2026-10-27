import { runMashup, wait } from "./pipeline";
import type { MashupProcessor } from "./types";

/**
 * Runs entirely in the browser with Web Audio DSP (see lib/audio/dsp.ts) when the AI separator
 * isn't running. Short pauses stand in for the latency of a real separation model.
 */
export const mockProcessor: MashupProcessor = {
  id: "mock-dsp",
  label: "Preview engine (no AI)",
  process(input, onProgress, signal) {
    return runMashup(
      input,
      async (stage) => {
        onProgress(stage);
        if (stage === "vocals" || stage === "instrumental") await wait(900, signal);
      },
      signal,
      null,
      this.id,
    );
  },
};
