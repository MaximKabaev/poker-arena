"use client";

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

  return (
    <div className="felt-bg rounded-3xl border-4 sm:border-8 border-zinc-800 shadow-2xl p-3 sm:p-5 md:p-8">
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
