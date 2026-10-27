"use client";

import { Check } from "lucide-react";
import { STAGES, type StageId } from "@/lib/processing";
import { Equalizer } from "./UploadSlot";

interface GenerateProgressProps {
  stage: StageId;
  /** Progress within the current stage (0..1), when it's long enough to report. */
  fraction?: number;
  tempoMatch: boolean;
  onCancel: () => void;
}

export function GenerateProgress({ stage, fraction, tempoMatch, onCancel }: GenerateProgressProps) {
  const stages = STAGES.filter((s) => s.id !== "tempo" || tempoMatch);
  const activeIndex = stages.findIndex((s) => s.id === stage);
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2.5" aria-live="polite">
        {stages.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={s.id} className={`flex flex-col gap-1.5 text-sm ${done || active ? "text-fg" : "text-muted"}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {done ? (
                    <Check size={16} className="text-b" aria-label="Done" />
                  ) : active ? (
                    <Equalizer color="var(--a)" bars={3} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                  )}
                </span>
                {s.label}
                {active && fraction !== undefined && (
                  <span className="font-mono text-xs text-muted tabular-nums">{Math.round(fraction * 100)}%</span>
                )}
              </div>
              {active && fraction !== undefined && (
                <div
                  className="ml-9 h-1 overflow-hidden rounded-full bg-line-strong"
                  role="progressbar"
                  aria-label={s.label}
                  aria-valuenow={Math.round(fraction * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="bg-mashup h-full transition-[width]" style={{ width: `${fraction * 100}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={onCancel}
        className="self-start rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-fg"
      >
        Cancel
      </button>
    </div>
  );
}
