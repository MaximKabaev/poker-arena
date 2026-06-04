"use client";

import { useEffect, useState } from "react";
import type { AgentStats, Table } from "@/lib/types";
import { Card } from "./Card";
import { PlayerSeat } from "./PlayerSeat";

interface Props {
  table: Table;
  statsByAgent: Record<string, AgentStats | null>;
  summaryByAgent?: Record<string, string>;
}

// Mobile-first: board+pot strip on top, seats below in a 2-col responsive grid.
// On md+ we drop seats into top/bottom rows and let the felt show through.
export function PokerTable({ table, statsByAgent, summaryByAgent }: Props) {
  const hero = table.selfSeatNumber;
  const seats = [...table.seats].sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0));
  const half = Math.ceil(seats.length / 2);
  const top = seats.slice(0, half);
  const bottom = seats.slice(half);
  const actingSeat = seats.find((s) => s.seatNumber === table.actingSeatNumber);
  const heroIsActing = !!actingSeat && actingSeat.seatNumber === hero;

  return (
    <div className="felt-bg rounded-3xl border-4 sm:border-8 border-zinc-800 shadow-2xl p-3 sm:p-5 md:p-8">
      {/* Acting banner — always visible while a hand is in progress */}
      {actingSeat && (
        <div
          className={`mb-3 mx-auto max-w-md rounded-xl px-3 py-2 border text-center text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 flex-wrap ${
            heroIsActing
              ? "bg-amber-400/30 border-amber-300/60 text-amber-100 shadow-glow"
              : "bg-zinc-900/70 border-zinc-700/70 text-zinc-200"
          }`}
        >
          <span className="text-yellow-300">▶</span>
          {heroIsActing ? (
            <span>Your turn</span>
          ) : (
            <>
              <span>Acting:</span>
              <span className="font-bold truncate max-w-[14rem]">
                {actingSeat.agentName || actingSeat.agentHandle}
              </span>
              {actingSeat.agentHandle && (
                <span className="text-[10px] text-zinc-400">@{actingSeat.agentHandle}</span>
              )}
            </>
          )}
          {table.actionDeadlineAt && (
            <ActionCountdown deadlineMs={table.actionDeadlineAt * 1000} />
          )}
        </div>
      )}

      {/* Center strip: street, pot, board cards */}
      <div className="flex flex-col items-center mb-3 sm:mb-5">
        <div className="text-zinc-200/90 text-[10px] sm:text-xs uppercase tracking-wider">
          {table.street}
        </div>
        <div className="text-yellow-300 font-bold text-xl sm:text-2xl">
          Pot: {table.potChips.toLocaleString()}
        </div>
        <div className="flex gap-1.5 sm:gap-2 mt-2">
          {Array.from({ length: 5 }).map((_, i) => {
            const c = table.boardCards[i];
            return <Card key={i} card={c} hidden={!c} size="md" />;
          })}
        </div>
        <div className="text-[10px] sm:text-[11px] text-zinc-200/70 mt-1">
          SB {table.smallBlindChips} / BB {table.bigBlindChips} · table #{table.tableNumber}
        </div>
      </div>

      {/* Seats: responsive grid. 2 cols on small, 3 cols on md+. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
        {top.map((s) => (
          <PlayerSeat
            key={s.seatId}
            seat={s}
            isHero={s.seatNumber === hero}
            isActing={s.seatNumber === table.actingSeatNumber}
            bigBlind={table.bigBlindChips}
            stats={statsByAgent[s.agentId]}
            summary={summaryByAgent?.[s.agentId]}
          />
        ))}
      </div>

      {/* Spacer between rows on md+ to evoke the felt center */}
      <div className="hidden md:block h-3" />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 mt-2 md:mt-0">
        {bottom.map((s) => (
          <PlayerSeat
            key={s.seatId}
            seat={s}
            isHero={s.seatNumber === hero}
            isActing={s.seatNumber === table.actingSeatNumber}
            bigBlind={table.bigBlindChips}
            stats={statsByAgent[s.agentId]}
            summary={summaryByAgent?.[s.agentId]}
          />
        ))}
      </div>
    </div>
  );
}

function ActionCountdown({ deadlineMs }: { deadlineMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remain = Math.max(0, deadlineMs - now) / 1000;
  const tight = remain <= 3;
  return (
    <span
      className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
        tight ? "bg-red-500/30 text-red-200" : "bg-zinc-800/70 text-zinc-300"
      }`}
    >
      {remain.toFixed(1)}s
    </span>
  );
}
