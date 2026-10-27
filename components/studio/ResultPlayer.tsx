"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Pause, Play, Save } from "lucide-react";
import { formatTime } from "@/lib/audio/decode";
import { Waveform } from "./Waveform";

interface ResultPlayerProps {
  url: string;
  peaks: Float32Array;
  durationSec: number;
  title: string;
  onTitleChange: (title: string) => void;
  onSave: () => void;
  saveState: "idle" | "saving" | "saved";
  saveError: string | null;
  storageLabel: string;
}

export function ResultPlayer(props: ResultPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setTime(audioRef.current?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const filename = `${props.title.replace(/[^\w\s×-]+/g, "").trim() || "mashup"}.wav`;

  return (
    <div className="flex flex-col gap-4">
      <audio
        ref={audioRef}
        src={props.url}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause mashup" : "Play mashup"}
          className="bg-mashup flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-on-accent shadow-lg transition-transform hover:scale-105"
        >
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <Waveform
            peaks={props.peaks}
            durationSec={props.durationSec}
            accent="var(--a)"
            accentEnd="var(--b)"
            playheadSec={playing || time > 0 ? time : null}
            height={64}
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted tabular-nums">
            <span>{formatTime(time)}</span>
            <span>{formatTime(props.durationSec)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mashup-title" className="text-xs font-semibold tracking-wider text-muted uppercase">
          Title
        </label>
        <input
          id="mashup-title"
          value={props.title}
          onChange={(e) => props.onTitleChange(e.target.value)}
          className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm outline-none focus:border-fg"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={props.url}
          download={filename}
          className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Download size={15} /> Download WAV
        </a>
        <button
          type="button"
          onClick={props.onSave}
          disabled={props.saveState !== "idle"}
          className="flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:opacity-70"
        >
          {props.saveState === "saved" ? <Check size={15} className="text-b" /> : <Save size={15} />}
          {props.saveState === "saving" ? "Saving…" : props.saveState === "saved" ? "Saved" : "Save to My mashups"}
        </button>
      </div>
      <p className="text-xs text-muted">{props.storageLabel}</p>
      {props.saveError && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {props.saveError}
        </p>
      )}
    </div>
  );
}
