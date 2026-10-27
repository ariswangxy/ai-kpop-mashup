import { demucsProcessor } from "./demucs";
import { mockProcessor } from "./mock";
import type { MashupProcessor } from "./types";

/** The AI processor when the local separator is running, otherwise the in-browser preview engine. */
export function getProcessor(separatorUp: boolean): MashupProcessor {
  return separatorUp ? demucsProcessor : mockProcessor;
}

export { checkSeparator, findBeatsWithAi, type AiBeats, type SeparatorStatus } from "./demucs";
export * from "./types";
