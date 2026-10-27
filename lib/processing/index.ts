import { browserDemucsProcessor } from "./browser";
import { demucsProcessor } from "./demucs";
import { mockProcessor } from "./mock";
import type { MashupProcessor } from "./types";

/**
 * The local separator when it's running (best model, no download), else Demucs in the browser
 * when it can run here, else the DSP preview engine.
 */
export function getProcessor(separatorUp: boolean, browserAi: boolean): MashupProcessor {
  if (separatorUp) return demucsProcessor;
  return browserAi ? browserDemucsProcessor : mockProcessor;
}

export { browserAiSupported, modelCached } from "./browser";
export { MODEL_MB } from "./htdemucs";
export { checkSeparator, findBeatsWithAi, type AiBeats, type SeparatorStatus } from "./demucs";
export * from "./types";
