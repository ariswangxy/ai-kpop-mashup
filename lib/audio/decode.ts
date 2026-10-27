export const ACCEPTED_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg"];
export const ACCEPTED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class AudioFileError extends Error {}

/** Check type and size before spending time decoding. */
export function validateAudioFile(file: File) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new AudioFileError(`"${file.name}" isn't a supported audio file. Use MP3, WAV, M4A or OGG.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AudioFileError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
  }
}

let sharedContext: AudioContext | null = null;

export function getAudioContext() {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

export async function decodeAudioFile(file: File, minDurationSec: number): Promise<AudioBuffer> {
  validateAudioFile(file);
  let buffer: AudioBuffer;
  try {
    buffer = await getAudioContext().decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new AudioFileError(`Couldn't read "${file.name}". The file may be damaged or in an unsupported codec.`);
  }
  if (buffer.duration < minDurationSec) {
    throw new AudioFileError(
      `"${file.name}" is ${buffer.duration.toFixed(1)} s long. Pick a track that's at least ${minDurationSec} s.`,
    );
  }
  return buffer;
}

/** Downsample a buffer to `buckets` peak values (0..1) for drawing a waveform. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(buffer.length / buckets));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const start = b * size;
    const end = Math.min(start + size, buffer.length);
    for (const data of channels) {
      for (let i = start; i < end; i += 4) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks[b] = max;
  }
  return peaks;
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
