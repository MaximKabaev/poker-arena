"use client";

import { useState } from "react";
import { getWindowAgentId, openWindowForAgent, urlForAgent } from "@/lib/clientFetch";

export interface AgentPublic {
  agentId: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
  apiKeyPrefix: string;
  createdAt: string;
  source: "imported" | "registered";
  isActive: boolean;
}

interface Props {
  agents: AgentPublic[];
  max: number;
  onAgentsChanged: () => void;
  onAddNew: () => void;
}

// The agent this WINDOW is controlling. Defaults to whatever ?a= says, then
// to whichever agent the server marks active. Switching here scopes only the
// current tab — other tabs keep playing their own agents.
export function AgentSwitcher({ agents, max, onAgentsChanged, onAddNew }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const windowAgentId = getWindowAgentId();
  const activeForWindow =
    agents.find((a) => a.agentId === windowAgentId) ??
    agents.find((a) => a.isActive) ??
    agents[0];

  // Switch THIS tab to agent X by reloading with ?a=X.
  function switchThisWindow(agentId: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("a", agentId);
    window.location.href = url.toString();
  }

  async function remove(agentId: string) {
    if (
      !confirm(
        "Remove this agent from the store? The agent itself stays on dev.fun; only its credentials are forgotten here.",
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/agents/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onAgentsChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 max-w-[12rem]"
        title="Switch this window's active agent, or open another agent in a new window"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="truncate font-semibold">
          {activeForWindow?.agentName || activeForWindow?.agentHandle || "no agent"}
        </span>
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 z-30 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800 flex items-center justify-between">
              <span>This window: {activeForWindow?.agentName ?? "—"}</span>
              <span>{agents.length}/{max}</span>
            </div>
            <ul className="max-h-80 overflow-y-auto scrollbar-thin">
              {agents.map((a) => {
                const isCurrent = activeForWindow?.agentId === a.agentId;
                return (
                  <li key={a.agentId} className="border-b border-zinc-800 last:border-0">
                    <div className="flex items-stretch">
                      <button
                        onClick={() => {
                          if (isCurrent) {
                            setOpen(false);
                          } else {
                            switchThisWindow(a.agentId);
                          }
                        }}
                        disabled={busy}
                        className={`flex-1 text-left px-3 py-2 text-xs hover:bg-zinc-800/70 ${
                          isCurrent ? "bg-zinc-800/60" : ""
                        }`}
                        title="Switch THIS window to this agent"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isCurrent ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                          />
                          <span className="font-semibold truncate">
                            {a.agentName || a.agentHandle || a.agentId}
                          </span>
                          {a.isActive && (
                            <span className="text-[9px] uppercase text-zinc-500">default</span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">
                          {a.apiKeyPrefix}… · {a.source}
                        </div>
                      </button>
                      <a
                        href={urlForAgent(a.agentId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openWindowForAgent(a.agentId);
                        }}
                        className="px-3 flex items-center text-zinc-400 hover:text-emerald-300 hover:bg-zinc-800/60 text-sm border-l border-zinc-800"
                        title="Open this agent in a NEW window — play two agents at once"
                      >
                        ↗
                      </a>
                      <button
                        onClick={() => remove(a.agentId)}
                        disabled={busy}
                        className="px-3 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 text-xs border-l border-zinc-800"
                        title="Remove this agent from the store"
                        aria-label="Remove agent"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {agents.length < max && (
              <button
                onClick={() => {
                  setOpen(false);
                  onAddNew();
                }}
                className="w-full text-xs px-3 py-2 text-emerald-300 hover:bg-zinc-800 border-t border-zinc-800 text-left font-semibold"
              >
                + Add new agent
              </button>
            )}
            <div className="px-3 py-2 text-[10px] text-zinc-500 border-t border-zinc-800 leading-snug">
              <span className="text-zinc-400">Tip:</span> click ↗ to play two agents in two browser
              windows at the same time.
            </div>
            {err && (
              <div className="px-3 py-2 text-[11px] text-red-400 border-t border-zinc-800">{err}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
