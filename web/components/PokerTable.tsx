"use client";

import type { AgentStats, Table } from "@/lib/types";
import { Card } from "./Card";
import { PlayerSeat } from "./PlayerSeat";

interface Props {
  table: Table;
  statsByAgent: Record<string, AgentStats | null>;
}

export function PokerTable({ table, statsByAgent }: Props) {
  const hero = table.selfSeatNumber;
  // sort seats so hero appears at the bottom, others arranged clockwise
  const seats = [...table.seats].sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0));

  return (
    <div className="relative felt-bg rounded-[3rem] border-8 border-zinc-800 shadow-2xl p-6 md:p-10 min-h-[460px]">
      {/* center pot + board */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-zinc-200/90 text-xs uppercase tracking-wider mb-1">
          {table.street}
        </div>
        <div className="text-yellow-300 font-bold text-2xl mb-2">
          Pot: {table.potChips.toLocaleString()}
        </div>
        <div className="flex gap-2 mb-2">
          {Array.from({ length: 5 }).map((_, i) => {
            const c = table.boardCards[i];
            return (
              <Card
                key={i}
                card={c}
                hidden={!c}
                size="md"
              />
            );
          })}
        </div>
        <div className="text-[11px] text-zinc-200/70">
          SB {table.smallBlindChips} / BB {table.bigBlindChips} · table #{table.tableNumber}
        </div>
      </div>

      {/* seats arranged around the felt */}
      <div className="relative grid grid-cols-3 gap-4 z-10">
        <div className="col-span-3 flex justify-center pointer-events-auto">
          <div className="grid grid-cols-3 gap-3 w-full max-w-3xl">
            {seats.slice(0, 3).map((s) => (
              <PlayerSeat
                key={s.seatId}
                seat={s}
                isHero={s.seatNumber === hero}
                isActing={s.seatNumber === table.actingSeatNumber}
                bigBlind={table.bigBlindChips}
                stats={statsByAgent[s.agentId]}
              />
            ))}
          </div>
        </div>
        <div className="col-span-3" />
        <div className="col-span-3 flex justify-center pointer-events-auto">
          <div className="grid grid-cols-3 gap-3 w-full max-w-3xl">
            {seats.slice(3, 6).map((s) => (
              <PlayerSeat
                key={s.seatId}
                seat={s}
                isHero={s.seatNumber === hero}
                isActing={s.seatNumber === table.actingSeatNumber}
                bigBlind={table.bigBlindChips}
                stats={statsByAgent[s.agentId]}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
