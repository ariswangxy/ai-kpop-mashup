"use client";

import { Minus, Plus } from "lucide-react";
import { keyName, MAX_KEY_SHIFT, transpose, type MusicalKey } from "@/lib/audio/key";
import { MAX_STRETCH, matchTempo } from "@/lib/audio/tempo";
import { activeKeyShift, type MixSettings } from "@/lib/processing";

interface MixControlsProps {
  settings: MixSettings;
  onChange: (settings: MixSettings) => void;
  /** null = no track loaded yet; a loaded track with unknown tempo has bpm null. */
  bpmA: number | null | undefined;
  bpmB: number | null | undefined;
  keyA: MusicalKey | null | undefined;
  keyB: MusicalKey | null | undefined;
}

const MAX_GAIN = 1.5;

export function MixControls({ settings, onChange, bpmA, bpmB, keyA, keyB }: MixControlsProps) {
  return (
    <div className="flex flex-col gap-5">
      <LengthPicker settings={settings} onChange={onChange} />
      <Level
        id="vocal-level"
        label="Vocal level"
        accent="var(--a)"
        value={settings.vocalGain}
        onChange={(vocalGain) => onChange({ ...settings, vocalGain })}
      />
      <Level
        id="inst-level"
        label="Instrumental level"
        accent="var(--b)"
        value={settings.instGain}
        onChange={(instGain) => onChange({ ...settings, instGain })}
      />

      <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span id="tempo-label" className="text-xs font-semibold tracking-wider text-muted uppercase">
            Tempo match
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.tempoMatch}
            aria-labelledby="tempo-label"
            onClick={() => onChange({ ...settings, tempoMatch: !settings.tempoMatch })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              settings.tempoMatch ? "bg-mashup" : "bg-line-strong"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-fg shadow transition-transform ${
                settings.tempoMatch ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-muted">
          <TempoStatus enabled={settings.tempoMatch} bpmA={bpmA} bpmB={bpmB} />
        </p>
      </div>

      <KeyControl settings={settings} onChange={onChange} keyA={keyA} keyB={keyB} />
    </div>
  );
}

function TempoStatus({ enabled, bpmA, bpmB }: { enabled: boolean; bpmA?: number | null; bpmB?: number | null }) {
  if (!enabled) return <>Off. The vocals keep Song A&apos;s original speed.</>;
  if (bpmA === undefined || bpmB === undefined) {
    return <>Stretches Song A&apos;s vocals to Song B&apos;s tempo without changing pitch, then lines up the beats.</>;
  }
  if (bpmA === null || bpmB === null) {
    return <>Couldn&apos;t detect the tempo of Song {bpmA === null ? "A" : "B"}. Type its BPM in to use tempo match.</>;
  }
  const m = matchTempo(bpmA, bpmB);
  const pct = (m.speed - 1) * 100;
  if (!m.inRange) {
    return (
      <span className="text-danger">
        These tempos are {Math.abs(pct).toFixed(0)}% apart. Stretching more than {MAX_STRETCH * 100}% sounds
        broken, so this mix will skip tempo match. Check the BPMs if they look wrong.
      </span>
    );
  }
  return (
    <>
      Vocals go from <span className="font-mono text-a tabular-nums">{m.sourceBpm.toFixed(1)}</span> to{" "}
      <span className="font-mono text-b tabular-nums">{m.targetBpm.toFixed(1)}</span> BPM (
      <span className="font-mono tabular-nums">
        {pct >= 0 ? "+" : "−"}
        {Math.abs(pct).toFixed(1)}%
      </span>
      ). Pitch stays the same, and the beats are lined up.
      {m.sourceBpm !== bpmA && " Song A is treated as " + (m.sourceBpm > bpmA ? "double" : "half") + " time."}
    </>
  );
}

const LENGTHS = [
  { id: "clip", label: "30-second clip", hint: "Just the two picked sections, mixed for 30 seconds." },
  {
    id: "full",
    label: "Full song",
    hint: "All of Song A's vocals over all of Song B's instrumental, with the picked sections lined up.",
  },
] as const;

function LengthPicker({ settings, onChange }: Pick<MixControlsProps, "settings" | "onChange">) {
  const current = LENGTHS.find((l) => l.id === settings.length)!;
  return (
    <div className="flex flex-col gap-2">
      <span id="length-label" className="text-xs font-semibold tracking-wider text-muted uppercase">
        Length
      </span>
      <div role="radiogroup" aria-labelledby="length-label" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {LENGTHS.map((l) => {
          const active = l.id === settings.length;
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ ...settings, length: l.id })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-fg text-bg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {l.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">{current.hint}</p>
    </div>
  );
}

function KeyControl({ settings, onChange, keyA, keyB }: Omit<MixControlsProps, "bpmA" | "bpmB">) {
  const semitones = activeKeyShift({ key: keyA ?? null }, { key: keyB ?? null }, settings);
  const auto = settings.keyShift === "auto";
  const step = (delta: number) =>
    onChange({ ...settings, keyShift: Math.max(-MAX_KEY_SHIFT, Math.min(MAX_KEY_SHIFT, semitones + delta)) });
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span id="key-label" className="text-xs font-semibold tracking-wider text-muted uppercase">
          Key shift
        </span>
        <div className="flex items-center gap-1.5" role="group" aria-labelledby="key-label">
          <button
            type="button"
            onClick={() => onChange({ ...settings, keyShift: "auto" })}
            aria-pressed={auto}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              auto ? "bg-mashup text-on-accent" : "border border-line-strong text-muted hover:text-fg"
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={semitones <= -MAX_KEY_SHIFT}
            aria-label="Shift vocals down a semitone"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong hover:bg-surface disabled:opacity-40"
          >
            <Minus size={13} />
          </button>
          <output
            aria-live="polite"
            aria-label="Vocal shift in semitones"
            className="w-8 text-center font-mono text-sm tabular-nums"
          >
            {signed(semitones)}
          </output>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={semitones >= MAX_KEY_SHIFT}
            aria-label="Shift vocals up a semitone"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong hover:bg-surface disabled:opacity-40"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        <KeyStatus auto={auto} semitones={semitones} keyA={keyA} keyB={keyB} />
        {Math.abs(semitones) >= 4 && " Shifts this big change the character of the voice."}
      </p>
    </div>
  );
}

function KeyStatus(props: {
  auto: boolean;
  semitones: number;
  keyA: MusicalKey | null | undefined;
  keyB: MusicalKey | null | undefined;
}) {
  const { auto, semitones, keyA, keyB } = props;
  const units = `${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? "" : "s"}`;
  const move = keyA && (
    <>
      Vocals go from <span className="text-a">{keyName(keyA)}</span> to{" "}
      <span className="text-b">{keyName(transpose(keyA, semitones))}</span> ({semitones > 0 ? "up" : "down"} {units})
    </>
  );

  if (!auto) {
    if (semitones === 0) return <>Off. The vocals keep their original key.</>;
    return move ? <>Manual. {move}.</> : <>Manual. Vocals shift {semitones > 0 ? "up" : "down"} {units}.</>;
  }
  if (keyA === undefined || keyB === undefined) {
    return <>Moves Song A&apos;s vocals into Song B&apos;s key so they don&apos;t clash.</>;
  }
  if (!keyA || !keyB) {
    return <>Couldn&apos;t detect the key of Song {keyA ? "B" : "A"}. Pick it in the song card, or shift by hand.</>;
  }
  if (semitones === 0) {
    return (
      <>
        <span className="text-a">{keyName(keyA)}</span> is already in the same key as{" "}
        <span className="text-b">{keyName(keyB)}</span>. No shift needed.
      </>
    );
  }
  return <>{move} to fit Song B&apos;s <span className="text-b">{keyName(keyB)}</span>.</>;
}

function Level(props: { id: string; label: string; accent: string; value: number; onChange: (v: number) => void }) {
  const fill = `${(props.value / MAX_GAIN) * 100}%`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={props.id} className="text-xs font-semibold tracking-wider text-muted uppercase">
          {props.label}
        </label>
        <span className="font-mono text-xs tabular-nums">{Math.round(props.value * 100)}%</span>
      </div>
      <input
        id={props.id}
        type="range"
        min={0}
        max={MAX_GAIN}
        step={0.05}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="level w-full"
        style={{ "--accent": props.accent, "--fill": fill } as React.CSSProperties}
      />
    </div>
  );
}
