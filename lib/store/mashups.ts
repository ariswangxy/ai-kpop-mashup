import { del, entries, set } from "idb-keyval";
import { getOwnerId, getSupabase } from "@/lib/supabase/client";

export interface MashupRecord {
  id: string;
  title: string;
  songAName: string;
  songBName: string;
  aStartSec: number;
  bStartSec: number;
  vocalGain: number;
  instGain: number;
  /** Missing on mashups saved before tempo match existed. */
  aBpm?: number | null;
  bBpm?: number | null;
  tempoMatched?: boolean;
  /** Semitones the vocals were shifted; missing on older mashups. */
  keyShift?: number;
  fullSong?: boolean;
  processor: string;
  createdAt: string;
  audioUrl: string;
}

export interface SaveMashupInput {
  title: string;
  songA: File;
  songB: File;
  aStartSec: number;
  bStartSec: number;
  vocalGain: number;
  instGain: number;
  aBpm: number | null;
  bBpm: number | null;
  tempoMatched: boolean;
  keyShift: number;
  fullSong: boolean;
  processor: string;
  output: Blob;
}

type LocalRow = Omit<MashupRecord, "audioUrl"> & { audio: Blob };

const LOCAL_PREFIX = "mashup:";

export function storageMode(): "supabase" | "local" {
  return getSupabase() ? "supabase" : "local";
}

export async function saveMashup(input: SaveMashupInput): Promise<MashupRecord> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const base = {
    id,
    title: input.title,
    songAName: input.songA.name,
    songBName: input.songB.name,
    aStartSec: input.aStartSec,
    bStartSec: input.bStartSec,
    vocalGain: input.vocalGain,
    instGain: input.instGain,
    aBpm: input.aBpm,
    bBpm: input.bBpm,
    tempoMatched: input.tempoMatched,
    keyShift: input.keyShift,
    fullSong: input.fullSong,
    processor: input.processor,
    createdAt: new Date().toISOString(),
  };

  if (!supabase) {
    await set(LOCAL_PREFIX + id, { ...base, audio: input.output } satisfies LocalRow);
    return { ...base, audioUrl: URL.createObjectURL(input.output) };
  }

  const owner = getOwnerId();
  const songAPath = `${owner}/${id}/a-${safeName(input.songA.name)}`;
  const songBPath = `${owner}/${id}/b-${safeName(input.songB.name)}`;
  const outputPath = `${owner}/${id}.wav`;

  const uploads = await Promise.all([
    supabase.storage.from("tracks").upload(songAPath, input.songA, { contentType: input.songA.type || undefined }),
    supabase.storage.from("tracks").upload(songBPath, input.songB, { contentType: input.songB.type || undefined }),
    supabase.storage.from("mashups").upload(outputPath, input.output, { contentType: "audio/wav" }),
  ]);
  const failed = uploads.find((u) => u.error);
  if (failed?.error) throw new Error(`Upload failed: ${failed.error.message}`);

  const { error } = await supabase.from("mashups").insert({
    id,
    owner_id: owner,
    title: base.title,
    song_a_name: base.songAName,
    song_b_name: base.songBName,
    song_a_path: songAPath,
    song_b_path: songBPath,
    output_path: outputPath,
    a_start_sec: base.aStartSec,
    b_start_sec: base.bStartSec,
    vocal_gain: base.vocalGain,
    inst_gain: base.instGain,
    a_bpm: base.aBpm,
    b_bpm: base.bBpm,
    tempo_matched: base.tempoMatched,
    key_shift: base.keyShift,
    full_song: base.fullSong,
    processor: base.processor,
    status: "done",
  });
  if (error) throw new Error(`Couldn't save the mashup: ${error.message}`);

  return { ...base, audioUrl: URL.createObjectURL(input.output) };
}

export async function listMashups(): Promise<MashupRecord[]> {
  const supabase = getSupabase();

  if (!supabase) {
    const rows = await entries<string, LocalRow>();
    return rows
      .filter(([key]) => key.startsWith(LOCAL_PREFIX))
      .map(([, { audio, ...row }]) => ({ ...row, audioUrl: URL.createObjectURL(audio) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data, error } = await supabase
    .from("mashups")
    .select("*")
    .eq("owner_id", getOwnerId())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load mashups: ${error.message}`);
  if (!data.length) return [];

  const { data: signed, error: signError } = await supabase.storage
    .from("mashups")
    .createSignedUrls(data.map((r) => r.output_path), 60 * 60);
  if (signError) throw new Error(`Couldn't load audio: ${signError.message}`);

  return data.map((r, i) => ({
    id: r.id,
    title: r.title,
    songAName: r.song_a_name,
    songBName: r.song_b_name,
    aStartSec: Number(r.a_start_sec),
    bStartSec: Number(r.b_start_sec),
    vocalGain: Number(r.vocal_gain),
    instGain: Number(r.inst_gain),
    aBpm: r.a_bpm === null ? null : Number(r.a_bpm),
    bBpm: r.b_bpm === null ? null : Number(r.b_bpm),
    tempoMatched: r.tempo_matched,
    keyShift: r.key_shift,
    fullSong: r.full_song,
    processor: r.processor,
    createdAt: r.created_at,
    audioUrl: signed[i]?.signedUrl ?? "",
  }));
}

export async function deleteMashup(id: string) {
  const supabase = getSupabase();
  if (!supabase) return del(LOCAL_PREFIX + id);

  const owner = getOwnerId();
  const { data } = await supabase.from("mashups").select("song_a_path, song_b_path, output_path").eq("id", id).single();
  if (data) {
    await Promise.all([
      supabase.storage.from("tracks").remove([data.song_a_path, data.song_b_path]),
      supabase.storage.from("mashups").remove([data.output_path]),
    ]);
  }
  const { error } = await supabase.from("mashups").delete().eq("id", id).eq("owner_id", owner);
  if (error) throw new Error(`Couldn't delete: ${error.message}`);
}

function safeName(name: string) {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 80);
}
