"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/audio/decode";

interface WaveformProps {
  peaks: Float32Array;
  durationSec: number;
  /** Highlighted window. Omit to color the whole waveform. */
  region?: { startSec: number; lengthSec: number };
  onRegionChange?: (startSec: number) => void;
  /** CSS color for bars inside the region (or all bars), e.g. "var(--a)". */
  accent: string;
  /** Second color for a left-to-right gradient. */
  accentEnd?: string;
  playheadSec?: number | null;
  /** A labelled pin, e.g. where the chorus starts. */
  marker?: { sec: number; label: string } | null;
  /** Arrow keys call this (±1, with Shift for a bigger step) instead of moving by seconds. */
  onStep?: (direction: -1 | 1, big: boolean) => void;
  label?: string;
  height?: number;
}

export function Waveform({
  peaks,
  durationSec,
  region,
  onRegionChange,
  accent,
  accentEnd,
  playheadSec,
  marker,
  onStep,
  label = "Selected section",
  height = 88,
}: WaveformProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const dragOffset = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const resolve = (v: string) => {
      const m = v.match(/^var\((--[\w-]+)\)$/);
      return m ? styles.getPropertyValue(m[1]).trim() : v;
    };
    const muted = styles.getPropertyValue("--line-strong").trim();
    let fill: string | CanvasGradient = resolve(accent);
    if (accentEnd) {
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, resolve(accent));
      g.addColorStop(1, resolve(accentEnd));
      fill = g;
    }

    const barW = 3;
    const gap = 2;
    const bars = Math.max(1, Math.floor(width / (barW + gap)));
    const max = peaks.reduce((m, v) => Math.max(m, v), 0.01);
    const startX = region ? (region.startSec / durationSec) * width : 0;
    const endX = region ? ((region.startSec + region.lengthSec) / durationSec) * width : width;

    for (let i = 0; i < bars; i++) {
      const peak = peaks[Math.floor((i / bars) * peaks.length)] / max;
      const h = Math.max(2, peak * (height - 8));
      const x = i * (barW + gap);
      ctx.fillStyle = x + barW >= startX && x <= endX ? fill : muted;
      ctx.beginPath();
      ctx.roundRect(x, (height - h) / 2, barW, h, 1.5);
      ctx.fill();
    }
  }, [peaks, width, height, region, durationSec, accent, accentEnd]);

  const maxStart = region ? Math.max(0, durationSec - region.lengthSec) : 0;
  const clamp = (s: number) => Math.min(maxStart, Math.max(0, s));

  const secAt = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current!.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * durationSec;
    },
    [durationSec],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!region || !onRegionChange) return;
    const at = secAt(e.clientX);
    const inside = at >= region.startSec && at <= region.startSec + region.lengthSec;
    // Grab the window where it was clicked; clicking outside centers the window on the pointer.
    dragOffset.current = inside ? at - region.startSec : region.lengthSec / 2;
    if (!inside) onRegionChange(clamp(at - dragOffset.current));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!region || !onRegionChange || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    onRegionChange(clamp(secAt(e.clientX) - dragOffset.current));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!region || !onRegionChange) return;
    if (onStep && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
      return;
    }
    const step = e.shiftKey ? 5 : 1;
    const next =
      e.key === "ArrowLeft" ? region.startSec - step
      : e.key === "ArrowRight" ? region.startSec + step
      : e.key === "Home" ? 0
      : e.key === "End" ? maxStart
      : null;
    if (next === null) return;
    e.preventDefault();
    onRegionChange(clamp(next));
  };

  const pct = (s: number) => `${(s / durationSec) * 100}%`;
  const interactive = Boolean(region && onRegionChange);

  return (
    <div
      ref={wrapRef}
      className={`relative w-full touch-none select-none ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {region && (
        <div
          role={interactive ? "slider" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxStart)}
          aria-valuenow={Math.round(region.startSec)}
          aria-valuetext={`${formatTime(region.startSec)} to ${formatTime(region.startSec + region.lengthSec)}`}
          onKeyDown={onKeyDown}
          className="absolute inset-y-0 rounded-md border-2"
          style={{
            left: pct(region.startSec),
            width: pct(region.lengthSec),
            borderColor: accent,
            background: `color-mix(in srgb, ${accent} 10%, transparent)`,
          }}
        />
      )}
      {marker && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-fg/60"
          style={{ left: pct(marker.sec) }}
        >
          <span className="absolute -top-2 left-1 rounded bg-fg px-1 py-px text-[9px] font-bold tracking-wider text-bg uppercase">
            {marker.label}
          </span>
        </div>
      )}
      {playheadSec != null && (
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg" style={{ left: pct(playheadSec) }} />
      )}
    </div>
  );
}
