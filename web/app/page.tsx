"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PasswordGate } from "@/components/PasswordGate";
import { ClaimForm } from "@/components/ClaimForm";
import { PokerTable } from "@/components/PokerTable";
import { ActionPanel } from "@/components/ActionPanel";
import { EventFeed } from "@/components/EventFeed";
import type {
  ActionType,
  AgentStats,
  Table,
} from "@/lib/types";

type Phase = "loading" | "auth" | "claim" | "ready";

interface AgentMe {
  agentId: string;
  handle?: string;
  name?: string;
  quote?: string;
}

interface ClaimInfo {
  agentId: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<AgentMe | null>(null);
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [lobby, setLobby] = useState<unknown>(null);
  const [statsByAgent, setStatsByAgent] = useState<Record<string, AgentStats | null>>({});
  const [pollMs, setPollMs] = useState(3000);
  const [lastErr, setLastErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const statsRequestedRef = useRef<Set<string>>(new Set());

  // ----- bootstrap -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await fetch("/api/auth").then((r) => r.json());
        if (cancelled) return;
        if (!a.authed) {
          setPhase("auth");
          return;
        }
        const c = await fetch("/api/claim").then((r) => r.json());
        if (cancelled) return;
        if (c.claimed) {
          setClaim(c);
          setPhase("ready");
        } else {
          setPhase("claim");
        }
      } catch (e) {
        setLastErr((e as Error).message);
        setPhase("auth");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- after auth+claim, fetch agent me + start polling -----
  const fetchMe = useCallback(async () => {
    try {
      const m = await fetch("/api/agent").then((r) => r.json());
      if (!m.error) setMe(m);
    } catch {}
  }, []);

  const fetchTable = useCallback(async () => {
    try {
      const r = await fetch("/api/table");
      const j = await r.json();
      if (j.error) {
        setLastErr(j.error);
        return;
      }
      setLastErr(null);
      const t: Table | null = j.tables?.[0] ?? null;
      setTable(t);
      if (!t) {
        // no active table — fetch lobby for context
        const lob = await fetch("/api/lobby").then((r) => r.json()).catch(() => null);
        setLobby(lob);
      } else {
        setLobby(null);
        // lazily fetch opponent stats once per agent id
        for (const seat of t.seats) {
          if (!seat.agentId || statsRequestedRef.current.has(seat.agentId)) continue;
          statsRequestedRef.current.add(seat.agentId);
          fetch(`/api/stats?agentId=${encodeURIComponent(seat.agentId)}`)
            .then((r) => r.json())
            .then((s) => {
              if (s.error) return;
              setStatsByAgent((prev) => ({ ...prev, [seat.agentId]: s as AgentStats }));
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      setLastErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    fetchMe();
    fetchTable();
    const id = setInterval(fetchTable, pollMs);
    return () => clearInterval(id);
  }, [phase, fetchMe, fetchTable, pollMs]);

  // ----- actions -----
  async function submitAction(payload: {
    action: ActionType;
    amount?: number;
    message: string;
    reasoning?: string;
  }) {
    if (!table) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tableId: table.tableId, ...payload }),
      });
      const j = await res.json();
      if (!res.ok) {
        setSubmitMsg(`✗ ${j.error || `HTTP ${res.status}`}`);
      } else {
        setSubmitMsg(`✓ ${payload.action}${payload.amount ? ` ${payload.amount}` : ""}`);
        // immediate re-poll
        setTimeout(fetchTable, 250);
      }
    } catch (e) {
      setSubmitMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function joinLobby() {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch("/api/join", { method: "POST" });
      const j = await res.json();
      if (!res.ok) setSubmitMsg(`✗ ${j.error || `HTTP ${res.status}`}`);
      else setSubmitMsg(`✓ ${j.kind ?? "joined"}`);
      setTimeout(fetchTable, 500);
    } catch (e) {
      setSubmitMsg(`✗ ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    location.reload();
  }

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }
  if (phase === "auth") return <PasswordGate onAuthed={() => location.reload()} />;
  if (phase === "claim") return <ClaimForm onClaimed={() => location.reload()} />;

  const isHeroActing =
    table?.actingSeatNumber != null && table.actingSeatNumber === table.selfSeatNumber;
  const allowed = isHeroActing ? table?.allowedActions : null;

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
      <Header
        me={me}
        claim={claim}
        pollMs={pollMs}
        setPollMs={setPollMs}
        onRefresh={fetchTable}
        onLogout={logout}
      />

      {lastErr && (
        <div className="mb-3 text-sm bg-red-950/60 border border-red-900 text-red-200 rounded px-3 py-2">
          {lastErr}
        </div>
      )}

      {!table ? (
        <NoTable lobby={lobby} onJoin={joinLobby} busy={submitting} note={submitMsg} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-4">
            <PokerTable table={table} statsByAgent={statsByAgent} />
            <EventFeed events={table.recentEvents} />
          </div>
          <div className="space-y-3">
            <TurnBanner isHero={isHeroActing} deadline={table.actionDeadlineAt} />
            {allowed ? (
              <ActionPanel
                allowed={allowed}
                bigBlind={table.bigBlindChips}
                potChips={table.potChips}
                submitting={submitting}
                onSubmit={submitAction}
              />
            ) : (
              <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
                Waiting for your turn…
              </div>
            )}
            {submitMsg && (
              <div className="text-xs text-zinc-300 bg-zinc-900/80 border border-zinc-800 rounded px-3 py-2">
                {submitMsg}
              </div>
            )}
            <AllStatsList table={table} statsByAgent={statsByAgent} />
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  me,
  claim,
  pollMs,
  setPollMs,
  onRefresh,
  onLogout,
}: {
  me: AgentMe | null;
  claim: ClaimInfo | null;
  pollMs: number;
  setPollMs: (n: number) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const name = me?.name ?? claim?.agentName ?? "—";
  const handle = me?.handle ?? claim?.agentHandle;
  return (
    <header className="flex items-center justify-between gap-4 mb-4 bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3">
      <div>
        <div className="text-lg font-bold leading-tight">{name}</div>
        {handle && <div className="text-xs text-zinc-400">@{handle}</div>}
        {me?.quote && (
          <div className="text-[11px] text-zinc-500 italic mt-0.5 max-w-xl truncate">
            "{me.quote}"
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400">Poll</label>
        <select
          value={pollMs}
          onChange={(e) => setPollMs(Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700 rounded text-xs px-2 py-1"
        >
          <option value={1500}>1.5s</option>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
        </select>
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Refresh
        </button>
        <button
          onClick={onLogout}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function NoTable({
  lobby,
  onJoin,
  busy,
  note,
}: {
  lobby: unknown;
  onJoin: () => void;
  busy: boolean;
  note: string | null;
}) {
  const l = lobby as { position?: number; kind?: string } | null;
  return (
    <div className="mt-10 max-w-md mx-auto bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center">
      <h2 className="text-lg font-bold mb-2">No active table</h2>
      {l?.position != null && (
        <p className="text-sm text-zinc-400 mb-2">Lobby position: #{l.position}</p>
      )}
      <p className="text-sm text-zinc-400 mb-4">
        Join the matchmaking queue to be seated. You'll need ≥1 BB in bankroll.
      </p>
      <button
        onClick={onJoin}
        disabled={busy}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md py-2 px-4 font-semibold"
      >
        {busy ? "Joining…" : "Join lobby"}
      </button>
      {note && <div className="mt-3 text-xs text-zinc-400">{note}</div>}
    </div>
  );
}

function TurnBanner({ isHero, deadline }: { isHero: boolean; deadline?: number | null }) {
  if (!isHero) return null;
  return (
    <div className="bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded-xl px-3 py-2 text-sm font-semibold flex items-center justify-between">
      <span>It's your turn.</span>
      {deadline && <Countdown deadlineMs={deadline * 1000} />}
    </div>
  );
}

function Countdown({ deadlineMs }: { deadlineMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remain = Math.max(0, deadlineMs - now) / 1000;
  return <span className="font-mono">{remain.toFixed(1)}s</span>;
}

function AllStatsList({
  table,
  statsByAgent,
}: {
  table: Table;
  statsByAgent: Record<string, AgentStats | null>;
}) {
  const rows = table.seats
    .filter((s) => s.seatNumber !== table.selfSeatNumber)
    .map((s) => ({ seat: s, stats: statsByAgent[s.agentId] }));
  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">
        Opponents
      </div>
      <ul className="space-y-2">
        {rows.map(({ seat, stats }) => (
          <li key={seat.seatId} className="text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-200 truncate">
                {seat.agentName || seat.agentHandle}
              </span>
              <span className="text-zinc-500">@{seat.agentHandle}</span>
            </div>
            {stats?.playingStyle?.archetype && (
              <div className="text-[11px] text-zinc-400">
                {stats.playingStyle.archetype}
                {stats.playingStyle.tightness && (
                  <span className="text-zinc-500">
                    {" "}
                    · {stats.playingStyle.tightness}/{stats.playingStyle.aggression}
                  </span>
                )}
              </div>
            )}
            {stats?.playingStyle?.tagline && (
              <div className="text-[11px] text-zinc-500 italic">"{stats.playingStyle.tagline}"</div>
            )}
            <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] font-mono">
              <Stat label="VPIP" v={pct(stats?.vpip)} />
              <Stat label="PFR" v={pct(stats?.pfr)} />
              <Stat label="3B" v={pct(stats?.threeBetPct)} />
              <Stat label="AF" v={num(stats?.af)} />
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-zinc-500 italic text-xs">No opponents seated.</li>}
      </ul>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="bg-zinc-800/60 rounded px-1.5 py-0.5 flex flex-col items-center">
      <span className="text-[9px] text-zinc-500 uppercase">{label}</span>
      <span className="text-zinc-200">{v}</span>
    </div>
  );
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(0)}`;
}
function num(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(2);
}
