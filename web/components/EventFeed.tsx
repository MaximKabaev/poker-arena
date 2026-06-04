"use client";

import type { TableEvent } from "@/lib/types";

interface Props {
  events: TableEvent[];
}

const ACTION_COLORS: Record<string, string> = {
  fold: "text-zinc-400",
  check: "text-sky-300",
  call: "text-emerald-300",
  bet: "text-amber-300",
  raise: "text-orange-300",
  "all-in": "text-red-400 font-bold",
};

export function EventFeed({ events }: Props) {
  const sorted = [...events].sort((a, b) => b.sequence - a.sequence);
  return (
    <details className="bg-zinc-900/95 border border-zinc-800 rounded-xl" open>
      <summary className="px-3 py-2 text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-zinc-400 cursor-pointer select-none">
        Recent events ({sorted.length})
      </summary>
      <div className="px-3 pb-3 max-h-60 sm:max-h-72 overflow-y-auto scrollbar-thin">
        <ol className="space-y-1.5 text-[11px] sm:text-xs">
          {sorted.length === 0 && <li className="text-zinc-500 italic">No events yet</li>}
          {sorted.map((e) => (
            <li key={e.id} className="leading-snug">
              <span className="text-zinc-600 mr-1.5">#{e.sequence}</span>
              <span className="text-zinc-400 mr-1.5">[{e.street ?? "—"}]</span>
              {e.summary?.agentName && (
                <span className="text-zinc-200 font-medium mr-1">{e.summary.agentName}</span>
              )}
              {e.summary?.action && (
                <span className={ACTION_COLORS[e.summary.action] || "text-zinc-300"}>
                  {e.summary.action}
                  {e.summary.toAmount != null && ` → ${e.summary.toAmount}`}
                </span>
              )}
              {e.summary?.action == null && <span className="text-zinc-500">{e.type}</span>}
              {e.summary?.reasoning && (
                <div className="ml-5 sm:ml-7 text-[10px] sm:text-[11px] text-zinc-500 italic break-words">
                  "{e.summary.reasoning}"
                </div>
              )}
              {e.summary?.boardCards && e.summary.boardCards.length > 0 && (
                <div className="ml-5 sm:ml-7 text-[10px] sm:text-[11px] text-zinc-400 font-mono">
                  board: {e.summary.boardCards.join(" ")}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
