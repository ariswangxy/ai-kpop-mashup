"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Trash2 } from "lucide-react";
import { formatTime } from "@/lib/audio/decode";
import { deleteMashup, listMashups, storageMode, type MashupRecord } from "@/lib/store/mashups";

export function MashupLibrary() {
  const [items, setItems] = useState<MashupRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [mode, setMode] = useState<"supabase" | "local" | null>(null);

  useEffect(() => {
    setMode(storageMode());
    listMashups()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your mashups."));
  }, []);

  // Local mashups are served from object URLs; release them when leaving the page.
  useEffect(() => {
    if (!items) return;
    return () => items.forEach((i) => i.audioUrl.startsWith("blob:") && URL.revokeObjectURL(i.audioUrl));
  }, [items]);

  async function remove(id: string) {
    try {
      await deleteMashup(id);
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that mashup.");
    } finally {
      setConfirming(null);
    }
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  }

  if (!items) {
    return (
      <div className="grid gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong p-6">
        <p className="font-display text-sm font-bold">No saved mashups yet</p>
        <p className="text-sm text-muted">Make one in the studio and press “Save to My mashups”.</p>
        <Link href="/" className="rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg">
          Open the studio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {mode === "supabase" ? "Stored in your Supabase project." : "Stored in this browser only."}
      </p>
      <ul className="grid gap-3">
        {items.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold">{m.title}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    <span className="text-a">Vocals</span> {m.songAName} @ {formatTime(m.aStartSec)}
                  </span>
                  <span>
                    <span className="text-b">Beat</span> {m.songBName} @ {formatTime(m.bStartSec)}
                  </span>
                  {m.tempoMatched && m.bBpm && (
                    <span className="font-mono tabular-nums">Tempo matched to {m.bBpm.toFixed(1)} BPM</span>
                  )}
                  {m.fullSong && <span>Full song</span>}
                  {!!m.keyShift && (
                    <span className="font-mono tabular-nums">
                      Vocals {m.keyShift > 0 ? "+" : "−"}
                      {Math.abs(m.keyShift)} semitone{Math.abs(m.keyShift) === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
              </div>
              <time className="shrink-0 font-mono text-[11px] text-muted tabular-nums" dateTime={m.createdAt}>
                {new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </time>
            </div>
            <audio controls preload="none" src={m.audioUrl} className="w-full" />
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={m.audioUrl}
                download={`${m.title}.wav`}
                className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                <Download size={13} /> Download
              </a>
              {confirming === m.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className="rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-on-accent"
                  >
                    Delete for good
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-full px-3 py-1.5 text-xs text-muted hover:text-fg"
                  >
                    Keep it
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(m.id)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted hover:text-danger"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
