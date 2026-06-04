"use client";

import { useState } from "react";
import type { AgentStats, Seat } from "@/lib/types";
import { Card } from "./Card";

interface Props {
  seat: Seat;
  isHero: boolean;
  isActing: boolean;
  bigBlind: number;
  stats?: AgentStats | null;
}

const STATUS_COLOR: Record<string, string> = {
  Active: "border-emerald-400/60",
  AllIn: "border-yellow-400/80",
  Folded: "border-zinc-700 opacity-50",
  Pending: "border-zinc-600",
  Settled: "border-zinc-600",
};

export function PlayerSeat({ seat, isHero, isActing, bigBlind, stats }: Props) {
  const [open, setOpen] = useState(false);
  const ring = isActing ? "ring-2 ring-yellow-400 shadow-glow" : "";
  const border = STATUS_COLOR[seat.status] || "border-zinc-700";
  const stack = bigBlind > 0 ? (seat.stackChips / bigBlind).toFixed(1) : seat.stackChips.toString();
  const showHole = isHero && seat.holeCards && seat.holeCards.length > 0;

  return (
    <div
      className={`relative bg-zinc-900/95 backdrop-blur border ${border} ${ring} rounded-xl px-3 py-2 w-56 transition`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {seat.agentName || seat.agentHandle || "—"}
            {isHero && <span className="ml-1 text-blue-400 text-xs">(you)</span>}
          </div>
          <div className="text-xs text-zinc-500 truncate">@{seat.agentHandle}</div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
          title="Toggle full stats"
        >
          {open ? "−" : "i"}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <div>
          <span className="text-zinc-400">Stack </span>
          <span className="font-mono">{seat.stackChips.toLocaleString()}</span>
          <span className="text-zinc-500 ml-1">({stack}bb)</span>
        </div>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
            seat.status === "AllIn"
              ? "bg-yellow-500/20 text-yellow-300"
              : seat.status === "Folded"
              ? "bg-zinc-700 text-zinc-400"
              : seat.status === "Active"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-zinc-700/60 text-zinc-400"
          }`}
        >
          {seat.status}
        </span>
      </div>

      {seat.currentBetChips > 0 && (
        <div className="mt-1 text-xs text-amber-300">
          bet {seat.currentBetChips.toLocaleString()}
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        {isHero ? (
          <>
            <Card card={seat.holeCards?.[0]} size="sm" hidden={!showHole} />
            <Card card={seat.holeCards?.[1]} size="sm" hidden={!showHole} />
          </>
        ) : (
          <>
            <Card hidden size="sm" />
            <Card hidden size="sm" />
          </>
        )}
      </div>

      <StatsSummary stats={stats} />

      {open && (
        <div className="mt-2 pt-2 border-t border-zinc-800 text-xs space-y-1">
          {stats ? <StatsFull stats={stats} /> : <span className="text-zinc-500">No stats yet</span>}
        </div>
      )}
    </div>
  );
}

function StatsSummary({ stats }: { stats?: AgentStats | null }) {
  if (!stats) return null;
  const ps = stats.playingStyle || {};
  const tag = ps.tagline;
  const arche = ps.archetype;
  if (!tag && !arche) return null;
  return (
    <div className="mt-2 text-[11px] text-zinc-400 leading-snug">
      {arche && <span className="text-zinc-200 font-medium">{arche}</span>}
      {tag && <div className="text-zinc-500 italic">"{tag}"</div>}
    </div>
  );
}

function StatsFull({ stats }: { stats: AgentStats }) {
  const ps = stats.playingStyle || {};
  const fmt = (v: number | null | undefined) =>
    v == null ? <span className="text-zinc-600">—</span> : <span className="font-mono">{(v * 100).toFixed(1)}%</span>;
  const fmtN = (v: number | null | undefined) =>
    v == null ? <span className="text-zinc-600">—</span> : <span className="font-mono">{v.toFixed(2)}</span>;
  return (
    <>
      {ps.tightness && (
        <div>
          <span className="text-zinc-500">style </span>
          <span>
            {ps.tightness} / {ps.aggression}
          </span>
        </div>
      )}
      <Pair k="VPIP" v={fmt(stats.vpip)} />
      <Pair k="PFR" v={fmt(stats.pfr)} />
      <Pair k="3-bet" v={fmt(stats.threeBetPct)} />
      <Pair k="AF" v={fmtN(stats.af)} />
      <Pair k="Bluff%" v={fmt(stats.bluffPct)} />
      <Pair k="WTSD" v={fmt(stats.wtsd)} />
      <Pair k="WSD" v={fmt(stats.wsd)} />
      {stats.handsObserved != null && (
        <Pair k="hands" v={<span className="font-mono">{stats.handsObserved}</span>} />
      )}
    </>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{k}</span>
      {v}
    </div>
  );
}
