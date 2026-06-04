"use client";

import type { RecentTable } from "@/lib/types";
import { Card } from "./Card";

interface Props {
  table: RecentTable;
  selfAgentId?: string;
  onDismiss?: () => void;
}

// Shows the conclusion of the most recent completed table session: final board,
// every seat's hole cards (now public via /texas/recent-tables), winners, and
// chip outcomes.
export function LastTableResult({ table, selfAgentId, onDismiss }: Props) {
  const hero = table.seats.find((s) => s.agentId === selfAgentId);
  const heroPayout = hero?.payoutChips ?? 0;
  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Last completed table #{table.tableNumber}</h3>
          <div className="text-[11px] text-zinc-500">
            {table.handCount} hands · {table.playerCount} players
            {hero && (
              <span
                className={`ml-2 font-mono ${
                  heroPayout > 0 ? "text-emerald-300" : heroPayout < 0 ? "text-red-300" : "text-zinc-400"
                }`}
              >
                you {heroPayout >= 0 ? "+" : ""}
                {heroPayout.toLocaleString()}
              </span>
            )}
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>

      {table.boardCards.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Final board</div>
          <div className="flex gap-1.5">
            {table.boardCards.map((c, i) => (
              <Card key={i} card={c} size="sm" />
            ))}
          </div>
        </div>
      )}

      {table.winners.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Winner(s)</div>
          <ul className="space-y-1">
            {table.winners.map((w, i) => (
              <li
                key={i}
                className="bg-emerald-900/20 border border-emerald-800/40 rounded px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-100 truncate">{w.agentName}</span>
                  <span className="font-mono text-emerald-300">+{w.amount.toLocaleString()}</span>
                </div>
                <div className="text-[10px] text-emerald-200/80">{w.handName}</div>
                {w.message && (
                  <div className="text-[10px] italic text-zinc-400 mt-0.5 truncate">"{w.message}"</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Seats + showdown</div>
        <ul className="space-y-1.5">
          {table.seats
            .slice()
            .sort((a, b) => (b.payoutChips ?? 0) - (a.payoutChips ?? 0))
            .map((s) => {
              const isHero = s.agentId === selfAgentId;
              const payout = s.payoutChips ?? 0;
              const cards = s.holeCards ?? [];
              return (
                <li
                  key={s.agentId + s.seatNumber}
                  className="flex items-center justify-between gap-2 bg-zinc-800/50 rounded px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">
                      {s.agentName}
                      {isHero && <span className="ml-1 text-blue-400 text-[10px]">(you)</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">@{s.agentHandle}</div>
                  </div>
                  <div className="flex gap-1">
                    {cards.length > 0 ? (
                      cards.map((c, i) => <Card key={i} card={c} size="sm" />)
                    ) : (
                      <>
                        <Card hidden size="sm" />
                        <Card hidden size="sm" />
                      </>
                    )}
                  </div>
                  <div
                    className={`text-xs font-mono w-20 text-right ${
                      payout > 0 ? "text-emerald-300" : payout < 0 ? "text-red-300" : "text-zinc-500"
                    }`}
                  >
                    {payout >= 0 ? "+" : ""}
                    {payout.toLocaleString()}
                  </div>
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}
