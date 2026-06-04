"use client";

import { useState } from "react";

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
  onSwitched: () => void;
  onAddNew: () => void;
}

export function AgentSwitcher({ agents, max, onSwitched, onAddNew }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = agents.find((a) => a.isActive) ?? agents[0];

  async function pick(agentId: string) {
    if (agentId === active?.agentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/agents/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      onSwitched();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(agentId: string) {
    if (!confirm("Remove this agent from the store? The agent itself stays on dev.fun; only its credentials are forgotten here.")) {
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
      onSwitched();
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
        title="Switch active agent"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="truncate font-semibold">
          {active?.agentName || active?.agentHandle || "no agent"}
        </span>
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-72 z-30 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              Agents ({agents.length}/{max})
            </div>
            <ul className="max-h-64 overflow-y-auto scrollbar-thin">
              {agents.map((a) => (
                <li key={a.agentId} className="border-b border-zinc-800 last:border-0">
                  <div className="flex items-stretch">
                    <button
                      onClick={() => pick(a.agentId)}
                      disabled={busy}
                      className={`flex-1 text-left px-3 py-2 text-xs hover:bg-zinc-800/70 ${
                        a.isActive ? "bg-zinc-800/60" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            a.isActive ? "bg-emerald-400" : "bg-zinc-600"
                          }`}
                        />
                        <span className="font-semibold truncate">
                          {a.agentName || a.agentHandle || a.agentId}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">
                        {a.apiKeyPrefix}… · {a.source}
                      </div>
                    </button>
                    <button
                      onClick={() => remove(a.agentId)}
                      disabled={busy}
                      className="px-3 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 text-xs"
                      title="Remove this agent from the store"
                      aria-label="Remove agent"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
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
            {err && (
              <div className="px-3 py-2 text-[11px] text-red-400 border-t border-zinc-800">{err}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
