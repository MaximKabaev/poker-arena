"use client";

import { useEffect, useMemo, useState } from "react";
import type { AllowedActions, ActionType } from "@/lib/types";

interface Props {
  allowed: AllowedActions;
  bigBlind: number;
  potChips: number;
  submitting: boolean;
  onSubmit: (a: {
    action: ActionType;
    amount?: number;
    message: string;
    reasoning?: string;
  }) => void;
}

const DEFAULT_MSG = "gl hf";

export function ActionPanel({ allowed, bigBlind, potChips, submitting, onSubmit }: Props) {
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [reasoning, setReasoning] = useState("");
  const [betTo, setBetTo] = useState<number>(0);
  const [raiseTo, setRaiseTo] = useState<number>(0);

  const betMin = allowed.minBet ?? allowed.callToAmount ?? 0;
  const betMax = allowed.maxCommit;
  const raiseMin = allowed.minRaiseTo ?? 0;
  const raiseMax = allowed.maxCommit;

  useEffect(() => {
    if (allowed.canBet) {
      const twoThirds = Math.round(potChips * 0.66);
      setBetTo(clamp(Math.max(twoThirds, betMin), betMin, betMax));
    }
    if (allowed.canRaise) {
      const guess = (allowed.callToAmount ?? 0) + potChips;
      setRaiseTo(clamp(Math.max(guess, raiseMin), raiseMin, raiseMax));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed.minBet, allowed.minRaiseTo, allowed.maxCommit, allowed.callToAmount, potChips]);

  const fire = (action: ActionType, amount?: number) => {
    if (!message.trim()) return;
    onSubmit({
      action,
      amount,
      message: message.trim().slice(0, 500),
      reasoning: reasoning.trim() ? reasoning.trim().slice(0, 150) : undefined,
    });
  };

  const bb = (v: number) => (bigBlind > 0 ? `${(v / bigBlind).toFixed(1)}bb` : "");

  return (
    <div className="bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-xl p-3 sm:p-4 space-y-3">
      <div className="text-[11px] sm:text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">Hint: </span>
        {allowed.actionHint}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:text-xs text-zinc-400">
        <div>
          Call to: <span className="font-mono text-zinc-200">{allowed.callToAmount ?? "—"}</span>
        </div>
        <div>
          Call: <span className="font-mono text-zinc-200">{allowed.callChips}</span>
        </div>
        <div>
          Min raise: <span className="font-mono text-zinc-200">{allowed.minRaiseTo ?? "—"}</span>
        </div>
        <div>
          Max commit: <span className="font-mono text-zinc-200">{allowed.maxCommit}</span>
        </div>
      </div>

      <div>
        <label className="block text-[11px] sm:text-xs text-zinc-400 mb-1">
          Chat message (required)
        </label>
        <input
          type="text"
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
      </div>

      <details className="text-xs text-zinc-300">
        <summary className="cursor-pointer text-zinc-400 select-none">
          Reasoning (optional, ≤150 chars)
        </summary>
        <input
          type="text"
          maxLength={150}
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          placeholder='{vr: "JJ+/AK", ke: "GTO 60%", pp: "IP barrel", sr: "1/2 pot"}'
          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-[11px] sm:text-xs font-mono outline-none focus:border-blue-500"
        />
      </details>

      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          label="Fold"
          color="bg-zinc-700 hover:bg-zinc-600"
          disabled={!allowed.canFold || submitting}
          onClick={() => fire("fold")}
        />
        <ActionButton
          label="Check"
          color="bg-sky-700 hover:bg-sky-600"
          disabled={!allowed.canCheck || submitting}
          onClick={() => fire("check")}
        />
        <ActionButton
          label={`Call ${allowed.callChips ? allowed.callChips.toLocaleString() : ""}`}
          color="bg-emerald-700 hover:bg-emerald-600 col-span-2"
          disabled={!allowed.canCall || submitting}
          onClick={() => fire("call")}
        />
      </div>

      {allowed.canBet && (
        <AmountRow
          label="Bet to"
          min={betMin}
          max={betMax}
          value={betTo}
          onChange={setBetTo}
          bb={bb}
          potChips={potChips}
          onFire={() => fire("bet", betTo)}
          disabled={submitting}
          color="bg-amber-600 hover:bg-amber-500"
        />
      )}

      {allowed.canRaise && (
        <AmountRow
          label="Raise to"
          min={raiseMin}
          max={raiseMax}
          value={raiseTo}
          onChange={setRaiseTo}
          bb={bb}
          potChips={potChips}
          onFire={() => fire("raise", raiseTo)}
          disabled={submitting}
          color="bg-orange-600 hover:bg-orange-500"
        />
      )}

      {allowed.canAllIn && (
        <ActionButton
          label={`All-in (${allowed.allInToAmount?.toLocaleString() ?? "?"})`}
          color="bg-red-700 hover:bg-red-600"
          disabled={submitting}
          onClick={() => fire("all-in", allowed.allInToAmount ?? undefined)}
        />
      )}
    </div>
  );
}

function ActionButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${color} disabled:opacity-30 disabled:cursor-not-allowed rounded-md py-2.5 px-3 font-semibold text-sm transition active:scale-[0.98]`}
    >
      {label}
    </button>
  );
}

function AmountRow({
  label,
  min,
  max,
  value,
  onChange,
  bb,
  potChips,
  onFire,
  disabled,
  color,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  bb: (n: number) => string;
  potChips: number;
  onFire: () => void;
  disabled?: boolean;
  color: string;
}) {
  const presets = useMemo(() => {
    const out: { label: string; v: number }[] = [];
    if (potChips > 0) {
      out.push({ label: "⅓", v: Math.round(potChips * 0.33) });
      out.push({ label: "½", v: Math.round(potChips * 0.5) });
      out.push({ label: "⅔", v: Math.round(potChips * 0.66) });
      out.push({ label: "pot", v: potChips });
    }
    return out
      .map((p) => ({ label: p.label, v: clamp(Math.max(p.v, min), min, max) }))
      .filter((p, i, arr) => arr.findIndex((x) => x.v === p.v) === i);
  }, [potChips, min, max]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] sm:text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-200">
          {value.toLocaleString()} <span className="text-zinc-500">({bb(value)})</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500 h-6"
        disabled={disabled || max <= min}
      />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.v)}
            className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 min-w-[2.5rem]"
          >
            {p.label}
          </button>
        ))}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0, min, max))}
          className="ml-auto w-24 sm:w-28 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono"
        />
      </div>
      <button
        onClick={onFire}
        disabled={disabled || value < min || value > max}
        className={`w-full ${color} disabled:opacity-30 disabled:cursor-not-allowed rounded-md py-2.5 font-semibold text-sm transition active:scale-[0.98]`}
      >
        {label} {value.toLocaleString()}
      </button>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
