"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PasswordGate } from "@/components/PasswordGate";
import { RegisterForm } from "@/components/RegisterForm";
import { AgentSwitcher, type AgentPublic } from "@/components/AgentSwitcher";
import { ClaimSection } from "@/components/ClaimSection";
import { LastTableResult } from "@/components/LastTableResult";
import { PokerTable } from "@/components/PokerTable";
import { ActionPanel } from "@/components/ActionPanel";
import { EventFeed } from "@/components/EventFeed";
import {
  isNotifyEnabled,
  setNotifyEnabled,
  notifyTableFound,
  notifyYourTurn,
  primeNotify,
} from "@/lib/notify";
import { clientFetch } from "@/lib/clientFetch";
import type {
  ActionType,
  AgentStats,
  RecentTable,
  ReplayEntry,
  Table,
} from "@/lib/types";

interface LobbyView {
  inLobby?: boolean;
  position?: number;
  total?: number;
  error?: string;
}

type RebuyResult =
  | { kind: "ok"; participant: { bankrollChips: number; totalChips: number; tableChips: number } }
  | { kind: "payment_required"; payload: unknown; message?: string }
  | { kind: "error"; message: string };

interface LeaderboardEntry {
  arenaId?: string;
  arenaName?: string;
  arenaStatus?: string;
  rank?: number;
  bestRank?: number;
  totalScore?: number;
  totalSubmissions?: number;
  streak?: number;
}

type Phase = "loading" | "auth" | "register" | "ready";

interface AgentMe {
  agentId: string;
  handle?: string;
  name?: string;
  quote?: string;
  status?: string;
  leaderboard?: LeaderboardEntry[];
}

interface AgentsResponse {
  agents: AgentPublic[];
  activeAgentId: string | null;
  max: number;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<AgentMe | null>(null);
  const [agentsInfo, setAgentsInfo] = useState<AgentsResponse | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  // Sticky copy of the last non-null table — keeps the UI visible between
  // turns and between hands within the same table session.
  const [lastSeenTable, setLastSeenTable] = useState<Table | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [statsByAgent, setStatsByAgent] = useState<Record<string, AgentStats | null>>({});
  const [summaryByAgent, setSummaryByAgent] = useState<Record<string, string>>({});
  const summariesRequestedRef = useRef<Set<string>>(new Set());
  const [pollMs, setPollMs] = useState(3000);
  const [lastErr, setLastErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [notifyOn, setNotifyOn] = useState(true);
  const [autoJoin, setAutoJoin] = useState(false);
  const [statsPanelOpen, setStatsPanelOpen] = useState(false);
  // Sticky "probably seated" flag set when /texas/join returns 409 — Arena's
  // only signal that we're already participating in this competition. Cleared
  // when we either see a live table or end up in the lobby.
  const [probablySeated, setProbablySeated] = useState(false);
  const [lastResult, setLastResult] = useState<RecentTable | null>(null);
  const [timeoutNote, setTimeoutNote] = useState<string | null>(null);
  const [replays, setReplays] = useState<ReplayEntry[] | null>(null);
  const statsRequestedRef = useRef<Set<string>>(new Set());
  const prevTableIdRef = useRef<string | null>(null);
  const prevHeroActingRef = useRef<boolean>(false);
  const joinInFlightRef = useRef<boolean>(false);
  // Tracks the current armed turn for timeout detection: (tableId, deadline).
  // Cleared when we successfully submit, or when the turn passes naturally.
  const armedTurnRef = useRef<{ tableId: string; deadline: number } | null>(null);
  // Remembers turns we've successfully acted on so re-runs of the timeout
  // effect (e.g. when autoJoin toggles) don't re-arm an already-resolved turn.
  const actedTurnRef = useRef<{ tableId: string; deadline: number } | null>(null);
  // Latest autoJoin value, read by the timeout timer's callback. Kept in a ref
  // so the timeout effect doesn't need autoJoin in its deps (which used to
  // cause toggling auto-rejoin to clobber armedTurnRef mid-turn).
  const autoJoinRef = useRef<boolean>(false);
  // Tracks which tableId we're currently looking for in /texas/recent-tables.
  // When set, a retry loop is actively polling for that id; clearing it
  // aborts the loop.
  const lastResultFetchedRef = useRef<string | null>(null);
  // Prevents multiple concurrent retry loops fighting over the same tableId
  // (each poll tick used to spawn its own).
  const lastResultInFlightRef = useRef<boolean>(false);

  // Kicks off a short-lived retry loop fetching /api/recent-tables until either
  // (a) the target tableId appears, (b) a new live table arrives (signalled
  // by the ref being overwritten), or (c) the budget runs out (~10s).
  const fetchLastResultWithRetry = useCallback(async (targetTableId: string) => {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < 10_000) {
      // Aborted by a new live table (ref overwritten elsewhere).
      if (lastResultFetchedRef.current !== targetTableId) return;
      try {
        const res = await clientFetch(`/api/recent-tables?limit=10`);
        const j = await res.json();
        const arr: RecentTable[] | undefined = (j as { data?: RecentTable[] })?.data;
        const finished = arr?.find((rt) => rt.id === targetTableId);
        if (finished) {
          setLastResult(finished);
          if (lastResultFetchedRef.current === targetTableId) {
            lastResultFetchedRef.current = null;
          }
          return;
        }
      } catch {
        // swallow — we'll just retry
      }
      attempt++;
      const delay = Math.min(600 + attempt * 250, 1500);
      await new Promise((r) => setTimeout(r, delay));
    }
    // Budget exhausted. Leave the ref so the next regular poll tick can still
    // pick up the result if Arena finally indexes the table.
  }, []);

  // Mirror the latest autoJoin into a ref so the timer below can read the
  // current value without forcing the effect to re-run on every toggle.
  useEffect(() => {
    autoJoinRef.current = autoJoin;
  }, [autoJoin]);

  // Arm a timeout watcher whenever it's our turn. If the deadline passes
  // without a successful submitAction (which clears armedTurnRef), we treat it
  // as an auto-fold and stop auto-rejoin so we don't burn through games while
  // the user is away.
  useEffect(() => {
    if (!table || !table.actionDeadlineAt) return;
    const isHero =
      table.actingSeatNumber != null && table.actingSeatNumber === table.selfSeatNumber;
    if (!isHero) return;
    const armed = { tableId: table.tableId, deadline: table.actionDeadlineAt };
    // If we've already submitted for this exact turn, the effect re-running
    // (e.g. because of an unrelated dep change in the past) must not re-arm
    // and re-trigger the safety.
    if (
      actedTurnRef.current?.tableId === armed.tableId &&
      actedTurnRef.current.deadline === armed.deadline
    ) {
      return;
    }
    armedTurnRef.current = armed;
    const wait = armed.deadline * 1000 - Date.now() + 750;
    // If the deadline is already in the past (stale state), don't arm — the
    // server has either already auto-folded or the next poll will refresh.
    if (wait <= 0) return;
    const id = setTimeout(() => {
      const cur = armedTurnRef.current;
      if (!cur) return;
      if (cur.tableId !== armed.tableId || cur.deadline !== armed.deadline) return;
      armedTurnRef.current = null;
      if (autoJoinRef.current) setAutoJoin(false);
      setTimeoutNote(
        "⏱ Action timed out — auto-rejoin disabled. Click Auto-rejoin to resume.",
      );
    }, wait);
    return () => clearTimeout(id);
    // Deliberately omit autoJoin / table from deps — only the identity of the
    // turn (tableId + deadline + hero seat) determines whether to arm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.tableId, table?.actionDeadlineAt, table?.actingSeatNumber, table?.selfSeatNumber]);

  // Load notify preference and prime audio on the first user interaction.
  useEffect(() => {
    setNotifyOn(isNotifyEnabled());
    const onInteract = () => {
      primeNotify();
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
    };
    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
    };
  }, []);

  const fetchAgents = useCallback(async (): Promise<AgentsResponse | null> => {
    try {
      const res = await fetch("/api/agents");
      const j = await res.json();
      if (!res.ok || j.error) {
        setLastErr(j.error || `HTTP ${res.status}`);
        return null;
      }
      setAgentsInfo(j);
      return j;
    } catch (e) {
      setLastErr((e as Error).message);
      return null;
    }
  }, []);

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
        const info = await fetchAgents();
        if (cancelled) return;
        if (!info || info.agents.length === 0) setPhase("register");
        else setPhase("ready");
      } catch (e) {
        setLastErr((e as Error).message);
        setPhase("auth");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAgents]);

  // ----- after auth+claim, fetch agent me + start polling -----
  const fetchMe = useCallback(async () => {
    try {
      const m = await clientFetch("/api/agent").then((r) => r.json());
      if (!m.error) setMe(m);
    } catch {}
  }, []);

  const doAutoJoinIfNeeded = useCallback(async (lob: LobbyView | null) => {
    if (!autoJoin) return;
    if (joinInFlightRef.current) return;
    if (lob?.inLobby) return; // already queued, just wait
    joinInFlightRef.current = true;
    try {
      const res = await clientFetch("/api/join", { method: "POST" });
      // 409 from /texas/join means Arena considers us "already participating"
      // for this competition — either queued in the lobby OR seated at a
      // table. /texas/lobby will tell us which one if it's the former.
      if (res.status === 409) {
        setProbablySeated(true);
        setSubmitMsg(
          "auto-join: Arena says we're already queued or seated. Waiting for a table…",
        );
        return;
      }
      const j = await res.json();
      if (!res.ok) {
        setSubmitMsg(`auto-join: ${j.error || `HTTP ${res.status}`}`);
      } else {
        setSubmitMsg(`auto-join: ${j.kind ?? "queued"}`);
      }
    } catch (e) {
      setSubmitMsg(`auto-join: ${(e as Error).message}`);
    } finally {
      joinInFlightRef.current = false;
    }
  }, [autoJoin]);

  const fetchTable = useCallback(async () => {
    try {
      const r = await clientFetch("/api/table");
      const j = await r.json();
      if (j.error) {
        setLastErr(j.error);
        return;
      }
      setLastErr(null);
      const t: Table | null = j.tables?.[0] ?? null;

      // Sound + vibrate on table-found and on hero-turn-start transitions.
      const newId = t?.tableId ?? null;
      const heroActing =
        !!t && t.actingSeatNumber != null && t.actingSeatNumber === t.selfSeatNumber;
      if (newId && newId !== prevTableIdRef.current) {
        notifyTableFound();
      } else if (heroActing && !prevHeroActingRef.current) {
        notifyYourTurn();
      }
      prevTableIdRef.current = newId;
      prevHeroActingRef.current = heroActing;

      setTable(t);
      if (t) {
        // Clear any prior session's completed-table result the moment we land
        // at a new table. Same-id case keeps the existing result (rare).
        setLastResult((cur) => (cur && cur.id !== t.tableId ? null : cur));
        lastResultFetchedRef.current = t.tableId;
        setLastSeenTable(t);
        setLobby(null);
        setProbablySeated(false); // table is visible now, no need to guess
        // Lazily fetch opponent stats + LLM summary once per agent id.
        for (const seat of t.seats) {
          const aid = seat.agentId;
          if (!aid) continue;
          if (!statsRequestedRef.current.has(aid)) {
            statsRequestedRef.current.add(aid);
            clientFetch(`/api/stats?agentId=${encodeURIComponent(aid)}`)
              .then((r) => r.json())
              .then((s) => {
                if (s.error) return;
                setStatsByAgent((prev) => ({ ...prev, [aid]: s as AgentStats }));
              })
              .catch(() => {});
          }
          // Skip summarizing self.
          if (aid === t.seats.find((x) => x.seatNumber === t.selfSeatNumber)?.agentId) continue;
          if (!summariesRequestedRef.current.has(aid)) {
            summariesRequestedRef.current.add(aid);
            clientFetch(`/api/opponent-summary?agentId=${encodeURIComponent(aid)}`)
              .then((r) => r.json())
              .then((s) => {
                if (s.summary) {
                  setSummaryByAgent((prev) => ({ ...prev, [aid]: s.summary as string }));
                }
              })
              .catch(() => {});
          }
        }
      } else {
        // No table this tick. Keep displaying the last one as the "waiting"
        // view, but also poll lobby state to detect session end vs mid-hand.
        const lob: LobbyView | null = await clientFetch("/api/lobby")
          .then((r) => r.json())
          .catch(() => null);
        setLobby(lob);
        if (lob?.inLobby) setProbablySeated(false); // confirmed queued, not seated
        // Keep the last table visible while we wait for the next one — the
        // matchmaking window is short (~10s) and the user wants to keep
        // reviewing the outcome. The sticky view is overwritten the moment a
        // real table arrives, so we don't need to clear it here.

        // Session may have ended (or we're sidelined). Run a 10s retry burst
        // against /texas/recent-tables — Arena often takes a few seconds to
        // index the completed table.
        //
        // We drive this off lastResultFetchedRef (set in the t-branch the
        // previous tick) rather than lastSeenTable, because lastSeenTable is
        // captured in this useCallback's stale closure and silently goes
        // empty after the first table. The retry guards against overlap with
        // lastResultInFlightRef.
        const targetTableId = lastResultFetchedRef.current;
        if (targetTableId && !lastResultInFlightRef.current) {
          lastResultInFlightRef.current = true;
          fetchLastResultWithRetry(targetTableId).finally(() => {
            lastResultInFlightRef.current = false;
          });
        }
        await doAutoJoinIfNeeded(lob);
      }
    } catch (e) {
      setLastErr((e as Error).message);
    }
  }, [doAutoJoinIfNeeded, fetchLastResultWithRetry]);

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
    // Disarm the timeout watcher BEFORE we await the network round-trip. If
    // the user clicks an action close to the deadline and the POST takes a
    // moment, the timer used to misfire and disable auto-rejoin even though
    // the user *did* act in time. We restore the ref on failure so a real
    // timeout (no retry) still trips the safety.
    const wasArmed = armedTurnRef.current;
    armedTurnRef.current = null;
    setTimeoutNote(null);
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await clientFetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tableId: table.tableId, ...payload }),
      });
      const j = await res.json();
      if (!res.ok) {
        setSubmitMsg(`✗ ${j.error || `HTTP ${res.status}`}`);
        armedTurnRef.current = wasArmed; // restore — real timeout can still trip
      } else {
        setSubmitMsg(`✓ ${payload.action}${payload.amount ? ` ${payload.amount}` : ""}`);
        // Remember this turn was successfully acted on so a later effect
        // re-run (autoJoin toggle, table object identity change, etc.) can't
        // wrongly re-arm the safety timer for the same turn.
        if (wasArmed) actedTurnRef.current = wasArmed;
        // immediate re-poll
        setTimeout(fetchTable, 250);
      }
    } catch (e) {
      setSubmitMsg(`✗ ${(e as Error).message}`);
      armedTurnRef.current = wasArmed;
    } finally {
      setSubmitting(false);
    }
  }

  async function joinLobbyOnce() {
    // Synchronous guard prevents double-fire from fast clicks (React state
    // updates are async, so `submitting` alone wouldn't catch a back-to-back
    // click in the same tick).
    if (joinInFlightRef.current) return;
    joinInFlightRef.current = true;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await clientFetch("/api/join", { method: "POST" });
      if (res.status === 409) {
        setProbablySeated(true);
        setSubmitMsg("Arena says we're already queued or seated.");
        return;
      }
      const j = await res.json();
      if (!res.ok) setSubmitMsg(`✗ ${j.error || `HTTP ${res.status}`}`);
      else setSubmitMsg(`✓ ${j.kind ?? "joined"}`);
      setTimeout(fetchTable, 500);
    } catch (e) {
      setSubmitMsg(`✗ ${(e as Error).message}`);
    } finally {
      joinInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  // POST /api/rebuy. First call returns 402 with payment requirements which we
  // pass straight back to the UI; user pays on-chain via the dev.fun dashboard
  // / their wallet and the caller can retry with the resulting txHash.
  async function attemptRebuy(txHash?: string): Promise<RebuyResult> {
    try {
      const res = await clientFetch("/api/rebuy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(txHash ? { txHash } : {}),
      });
      const j = await res.json();
      if (res.status === 402) {
        return { kind: "payment_required", payload: j.payload, message: j.error };
      }
      if (!res.ok) return { kind: "error", message: j.error || `HTTP ${res.status}` };
      return { kind: "ok", participant: j.participant };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }

  // Clicking the "Join" button enables continuous auto-join (game after game).
  // Clicking again ("Stop joining") disables it. The first click fires a manual
  // join immediately ONLY if we aren't already at a table or queued in the
  // lobby — in those cases the loop just arms and waits.
  function toggleAutoJoin() {
    const next = !autoJoin;
    setAutoJoin(next);
    if (next) {
      const atTable = !!table;
      const inLobby = !!lobby?.inLobby;
      if (!atTable && !inLobby) {
        joinLobbyOnce();
      } else {
        setSubmitMsg(
          atTable
            ? "auto-rejoin armed — will queue you after this game"
            : "auto-rejoin armed — already in lobby",
        );
      }
    } else {
      // Clear any in-flight "armed/already queued" messages so the UI doesn't
      // look like auto-join is still happening in this window.
      setProbablySeated(false);
      setSubmitMsg("auto-rejoin stopped");
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    location.reload();
  }

  async function loadReplays() {
    try {
      const res = await clientFetch("/api/replays?limit=15");
      const j = await res.json();
      if (Array.isArray(j.data)) setReplays(j.data);
    } catch {}
  }

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }
  if (phase === "auth") return <PasswordGate onAuthed={() => location.reload()} />;
  if (phase === "register") return <RegisterForm onRegistered={() => location.reload()} />;

  const isHeroActing =
    table?.actingSeatNumber != null && table.actingSeatNumber === table.selfSeatNumber;
  const allowed = isHeroActing ? table?.allowedActions : null;
  // displayTable: prefer the live table; otherwise show the last seen one as
  // a "waiting" view so the user keeps context between turns/hands.
  const displayTable = table ?? lastSeenTable;
  const isStaleView = !table && !!lastSeenTable;
  // Detect when hero is sidelined for the rest of the hand — useful because
  // pending-actions won't return the table again until a new hand begins (or
  // not at all if we busted out).
  const heroSeat = displayTable?.seats.find(
    (s) => s.seatNumber === displayTable.selfSeatNumber,
  );
  const heroSidelined =
    !!heroSeat &&
    (heroSeat.status === "AllIn" ||
      heroSeat.status === "Folded" ||
      (heroSeat.stackChips === 0 && heroSeat.status !== "Active"));
  const selfSeat = displayTable?.seats.find(
    (s) => s.seatNumber === displayTable.selfSeatNumber,
  );

  return (
    <div className="min-h-screen px-3 py-3 sm:px-4 sm:py-4 md:p-6 max-w-[1600px] mx-auto pb-32 xl:pb-6">
      <Header
        me={me}
        agentsInfo={agentsInfo}
        pollMs={pollMs}
        setPollMs={setPollMs}
        onRefresh={fetchTable}
        onLogout={logout}
        onAgentsChanged={() => location.reload()}
        onAddNew={() => setPhase("register")}
        notifyOn={notifyOn}
        onToggleNotify={() => {
          const next = !notifyOn;
          setNotifyOn(next);
          setNotifyEnabled(next);
          if (next) {
            primeNotify();
            notifyTableFound(); // quick confirmation buzz/beep when enabling
          }
        }}
        onOpenStats={() => setStatsPanelOpen(true)}
        autoJoin={autoJoin}
        onToggleAutoJoin={toggleAutoJoin}
      />

      {lastErr && (
        <div className="mb-3 text-xs sm:text-sm bg-red-950/60 border border-red-900 text-red-200 rounded px-3 py-2 break-words">
          {lastErr}
        </div>
      )}

      {timeoutNote && (
        <div className="mb-3 text-xs sm:text-sm bg-amber-950/60 border border-amber-700/60 text-amber-100 rounded px-3 py-2 flex items-center justify-between gap-2">
          <span>{timeoutNote}</span>
          <button
            onClick={() => setTimeoutNote(null)}
            className="text-amber-200 hover:text-amber-100 text-lg leading-none px-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {lastResult && (
        <div className="mb-3">
          <LastTableResult
            table={lastResult}
            selfAgentId={me?.agentId}
            onDismiss={() => setLastResult(null)}
          />
        </div>
      )}

      {!displayTable ? (
        <NoTable
          lobby={lobby}
          autoJoin={autoJoin}
          onToggleAutoJoin={toggleAutoJoin}
          busy={submitting}
          note={submitMsg}
          probablySeated={probablySeated && !lobby?.inLobby}
          onRebuy={attemptRebuy}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3 sm:gap-4">
          <div className="space-y-3 sm:space-y-4 min-w-0">
            {heroSidelined && (
              <div className="bg-red-900/30 border border-red-700/50 text-red-100 rounded-xl px-3 py-2 text-xs sm:text-sm">
                <span className="font-semibold">
                  {heroSeat?.status === "AllIn"
                    ? "You're all-in."
                    : heroSeat?.stackChips === 0
                    ? "You're busted — stack 0."
                    : "You've folded this hand."}
                </span>{" "}
                Arena won't push table updates again until either a new hand starts (if you
                still have chips) or the session ends. The final board + every opponent's
                showdown cards will appear below when the table closes.
              </div>
            )}
            {!heroSidelined && isStaleView && (
              <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded-xl px-3 py-2 text-xs sm:text-sm">
                Waiting for the next turn / hand — showing the last known state.
                {lobby?.inLobby && " (you're back in the lobby)"}
              </div>
            )}
            <PokerTable
              table={displayTable}
              statsByAgent={statsByAgent}
              summaryByAgent={summaryByAgent}
              isLive={!!table}
            />
            <EventFeed events={displayTable.recentEvents} />
          </div>
          <div className="space-y-3 min-w-0">
            <TurnBanner isHero={isHeroActing} deadline={displayTable.actionDeadlineAt} />
            {/* On mobile, action panel is rendered as a sticky bottom drawer (below). Inline copy hidden on small screens when it's the hero's turn — keeps the table visible. */}
            <div className={allowed ? "hidden xl:block" : ""}>
              {allowed && table ? (
                <ActionPanel
                  allowed={allowed}
                  bigBlind={table.bigBlindChips}
                  potChips={table.potChips}
                  submitting={submitting}
                  onSubmit={submitAction}
                />
              ) : (
                <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
                  {isStaleView
                    ? "Opponents acting — you'll be notified when it's your turn."
                    : "Waiting for your turn…"}
                </div>
              )}
            </div>
            {submitMsg && (
              <div className="text-xs text-zinc-300 bg-zinc-900/80 border border-zinc-800 rounded px-3 py-2 break-words">
                {submitMsg}
              </div>
            )}
            <AllStatsList
              table={displayTable}
              statsByAgent={statsByAgent}
              summaryByAgent={summaryByAgent}
            />
          </div>
        </div>
      )}

      {/* Mobile-only sticky action drawer */}
      {table && allowed && (
        <MobileActionDrawer
          table={table}
          allowed={allowed}
          submitting={submitting}
          onSubmit={submitAction}
        />
      )}

      {statsPanelOpen && (
        <MeStatsPanel
          me={me}
          selfStackChips={selfSeat?.stackChips ?? null}
          selfBigBlind={displayTable?.bigBlindChips ?? null}
          lobby={lobby}
          replays={replays}
          onLoadReplays={loadReplays}
          onClose={() => setStatsPanelOpen(false)}
        />
      )}
    </div>
  );
}

function Header({
  me,
  agentsInfo,
  pollMs,
  setPollMs,
  onRefresh,
  onLogout,
  onAgentsChanged,
  onAddNew,
  notifyOn,
  onToggleNotify,
  onOpenStats,
  autoJoin,
  onToggleAutoJoin,
}: {
  me: AgentMe | null;
  agentsInfo: AgentsResponse | null;
  pollMs: number;
  setPollMs: (n: number) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onAgentsChanged: () => void;
  onAddNew: () => void;
  notifyOn: boolean;
  onToggleNotify: () => void;
  onOpenStats: () => void;
  autoJoin: boolean;
  onToggleAutoJoin: () => void;
}) {
  const activeFromStore = agentsInfo?.agents.find((a) => a.isActive);
  const name = me?.name ?? activeFromStore?.agentName ?? "—";
  const handle = me?.handle ?? activeFromStore?.agentHandle;
  return (
    <header className="mb-3 sm:mb-4 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
      <div className="min-w-0">
        <div className="text-base sm:text-lg font-bold leading-tight truncate">{name}</div>
        {handle && <div className="text-[11px] sm:text-xs text-zinc-400 truncate">@{handle}</div>}
        {me?.quote && (
          <div className="hidden sm:block text-[11px] text-zinc-500 italic mt-0.5 max-w-xl truncate">
            "{me.quote}"
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        {agentsInfo && agentsInfo.agents.length > 0 && (
          <AgentSwitcher
            agents={agentsInfo.agents}
            max={agentsInfo.max}
            onAgentsChanged={onAgentsChanged}
            onAddNew={onAddNew}
          />
        )}
        <label className="text-[11px] sm:text-xs text-zinc-400">Poll</label>
        <select
          value={pollMs}
          onChange={(e) => setPollMs(Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700 rounded text-[11px] sm:text-xs px-2 py-1"
        >
          <option value={1500}>1.5s</option>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
        </select>
        <button
          onClick={onRefresh}
          className="text-[11px] sm:text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Refresh
        </button>
        <button
          onClick={onOpenStats}
          title="My stats, chips, leaderboard"
          className="text-[11px] sm:text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          📊 Me
        </button>
        <button
          onClick={onToggleAutoJoin}
          aria-pressed={autoJoin}
          title={
            autoJoin
              ? "Auto-rejoin is ON — click to stop after this game"
              : "Auto-rejoin is OFF — click to keep queueing game after game"
          }
          className={`text-[11px] sm:text-xs px-2 py-1 rounded border font-semibold ${
            autoJoin
              ? "bg-red-700/40 hover:bg-red-700/60 border-red-600/60 text-red-100"
              : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300"
          }`}
        >
          {autoJoin ? "● Auto-rejoin: stop" : "○ Auto-rejoin"}
        </button>
        <button
          onClick={onToggleNotify}
          aria-pressed={notifyOn}
          title={notifyOn ? "Sound + vibrate on table found (tap to mute)" : "Notifications muted (tap to enable)"}
          className={`text-[11px] sm:text-xs px-2 py-1 rounded border ${
            notifyOn
              ? "bg-emerald-700/40 hover:bg-emerald-700/60 border-emerald-600/60 text-emerald-100"
              : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-400"
          }`}
        >
          {notifyOn ? "🔔" : "🔕"}
        </button>
        <button
          onClick={onLogout}
          className="text-[11px] sm:text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function MobileActionDrawer({
  table,
  allowed,
  submitting,
  onSubmit,
}: {
  table: Table;
  allowed: NonNullable<Table["allowedActions"]>;
  submitting: boolean;
  onSubmit: (a: {
    action: import("@/lib/types").ActionType;
    amount?: number;
    message: string;
    reasoning?: string;
  }) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="xl:hidden fixed inset-x-0 bottom-0 z-30 px-2 pb-2">
      <div className="bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between bg-amber-500/20 px-3 py-2 text-amber-200 text-sm font-semibold"
        >
          <span>Your turn — act</span>
          <span className="text-xs">{open ? "hide ▾" : "show ▴"}</span>
        </button>
        {open && (
          <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
            <ActionPanel
              allowed={allowed}
              bigBlind={table.bigBlindChips}
              potChips={table.potChips}
              submitting={submitting}
              onSubmit={onSubmit}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NoTable({
  lobby,
  autoJoin,
  onToggleAutoJoin,
  busy,
  note,
  probablySeated,
  onRebuy,
}: {
  lobby: LobbyView | null;
  autoJoin: boolean;
  onToggleAutoJoin: () => void;
  busy: boolean;
  note: string | null;
  probablySeated?: boolean;
  onRebuy: (txHash?: string) => Promise<RebuyResult>;
}) {
  const [rebuyResult, setRebuyResult] = useState<RebuyResult | null>(null);
  const [rebuyBusy, setRebuyBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  async function runRebuy(hash?: string) {
    setRebuyBusy(true);
    try {
      const r = await onRebuy(hash);
      setRebuyResult(r);
      if (r.kind === "ok") setTxHash("");
    } finally {
      setRebuyBusy(false);
    }
  }
  const [diag, setDiag] = useState<null | {
    me?: unknown;
    lobby?: unknown;
    recent?: unknown;
    err?: string;
  }>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  async function runDiagnose() {
    setDiagBusy(true);
    setDiag({});
    try {
      const [meRes, lobRes, recRes] = await Promise.all([
        clientFetch("/api/agent").then((r) => r.json()).catch((e) => ({ error: String(e) })),
        clientFetch("/api/lobby").then((r) => r.json()).catch((e) => ({ error: String(e) })),
        clientFetch("/api/recent-tables?limit=3").then((r) => r.json()).catch((e) => ({ error: String(e) })),
      ]);
      setDiag({ me: meRes, lobby: lobRes, recent: recRes });
    } catch (e) {
      setDiag({ err: (e as Error).message });
    } finally {
      setDiagBusy(false);
    }
  }

  return (
    <div className="mt-10 max-w-md mx-auto bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center">
      <h2 className="text-lg font-bold mb-2">
        {probablySeated ? "Probably seated — awaiting first turn" : "No active table"}
      </h2>
      {probablySeated ? (
        <p className="text-sm text-zinc-400 mb-4">
          Arena returned 409 ("already participating") to our join attempt, but the lobby
          says you're not queued. Most likely you're seated at a table — the felt will
          appear here on your first turn (sound + vibrate too). If this lasts more than a
          minute, run the diagnostic below.
        </p>
      ) : lobby?.inLobby && lobby.position != null ? (
        <p className="text-sm text-zinc-400 mb-2">
          In lobby — position #{lobby.position}
          {lobby.total != null && ` of ${lobby.total}`}
        </p>
      ) : (
        <p className="text-sm text-zinc-400 mb-4">
          Click to start matchmaking. Auto-rejoin keeps you queued game after game until you stop. You'll need ≥1 BB in bankroll.
        </p>
      )}
      <button
        onClick={onToggleAutoJoin}
        disabled={busy && !autoJoin}
        aria-pressed={autoJoin}
        className={`rounded-md py-2 px-4 font-semibold transition ${
          autoJoin
            ? "bg-red-600 hover:bg-red-500"
            : "bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
        }`}
      >
        {autoJoin ? "Stop joining" : busy ? "Joining…" : "Join lobby (auto-rejoin)"}
      </button>
      {autoJoin && (
        <div className="mt-3 text-[11px] text-emerald-300">
          Auto-rejoin is on — will keep queueing you between games.
        </div>
      )}
      {note && <div className="mt-3 text-xs text-zinc-400 break-words">{note}</div>}

      <div className="mt-4 pt-3 border-t border-zinc-800 text-left">
        <div className="flex items-center justify-between mb-1">
          <div>
            <div className="text-xs font-semibold text-zinc-300">Bankroll empty?</div>
            <div className="text-[10px] text-zinc-500">
              If 409 persists, your bot may need a rebuy (on-chain MON payment).
            </div>
          </div>
          <button
            onClick={() => runRebuy()}
            disabled={rebuyBusy}
            className="text-[11px] bg-amber-700/40 hover:bg-amber-700/60 border border-amber-600/60 text-amber-100 rounded px-2 py-1 disabled:opacity-50"
          >
            {rebuyBusy ? "..." : "Try rebuy"}
          </button>
        </div>
        {rebuyResult?.kind === "ok" && (
          <div className="mt-2 text-xs bg-emerald-900/30 border border-emerald-700/50 text-emerald-100 rounded p-2">
            ✓ Rebuy succeeded. Bankroll:{" "}
            <span className="font-mono">{rebuyResult.participant.bankrollChips.toLocaleString()}</span>{" "}
            (total <span className="font-mono">{rebuyResult.participant.totalChips.toLocaleString()}</span>)
          </div>
        )}
        {rebuyResult?.kind === "payment_required" && (
          <div className="mt-2 text-[11px] bg-amber-950/60 border border-amber-700/60 text-amber-100 rounded p-2 space-y-1">
            <div className="font-semibold">Payment required (402)</div>
            <div className="text-zinc-300 break-words">
              {rebuyResult.message || "Pay the amount below from the agent wallet on dev.fun, then paste the tx hash here and retry."}
            </div>
            <pre className="bg-zinc-950/60 border border-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-zinc-300 max-h-40 font-mono">
              {JSON.stringify(rebuyResult.payload, null, 2)}
            </pre>
            <div className="flex gap-1.5 mt-1">
              <input
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x… tx hash from your wallet"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] font-mono outline-none focus:border-blue-500"
              />
              <button
                onClick={() => runRebuy(txHash.trim())}
                disabled={rebuyBusy || !txHash.trim()}
                className="text-[11px] bg-emerald-700/40 hover:bg-emerald-700/60 border border-emerald-600/60 text-emerald-100 rounded px-2 py-1 disabled:opacity-50"
              >
                Retry with txHash
              </button>
            </div>
          </div>
        )}
        {rebuyResult?.kind === "error" && (
          <div className="mt-2 text-xs bg-red-950/60 border border-red-900 text-red-200 rounded p-2 break-words">
            ✗ {rebuyResult.message}
          </div>
        )}
      </div>

      <details className="mt-4 text-left" open={diag != null}>
        <summary
          className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer select-none"
          onClick={(e) => {
            if (!diag) {
              e.preventDefault();
              runDiagnose();
            }
          }}
        >
          {diag ? "Diagnostic" : "Stuck? Click to diagnose"}
        </summary>
        {diag && (
          <div className="mt-2 space-y-2 text-[10px] font-mono text-zinc-400">
            <button
              onClick={runDiagnose}
              disabled={diagBusy}
              className="text-zinc-500 hover:text-zinc-200 underline text-[10px]"
            >
              {diagBusy ? "refreshing…" : "refresh"}
            </button>
            <DiagBlock label="/agent/me" v={diag.me} />
            <DiagBlock label="/texas/lobby" v={diag.lobby} />
            <DiagBlock label="/texas/recent-tables (last 3)" v={diag.recent} />
          </div>
        )}
      </details>
    </div>
  );
}

function DiagBlock({ label, v }: { label: string; v: unknown }) {
  if (v === undefined) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">{label}</div>
      <pre className="bg-zinc-950/60 border border-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-zinc-300 max-h-40">
        {JSON.stringify(v, null, 2)}
      </pre>
    </div>
  );
}

function MeStatsPanel({
  me,
  selfStackChips,
  selfBigBlind,
  lobby,
  replays,
  onLoadReplays,
  onClose,
}: {
  me: AgentMe | null;
  selfStackChips: number | null;
  selfBigBlind: number | null;
  lobby: LobbyView | null;
  replays: ReplayEntry[] | null;
  onLoadReplays: () => void;
  onClose: () => void;
}) {
  const board = me?.leaderboard ?? [];
  const stackBB = selfStackChips != null && selfBigBlind ? selfStackChips / selfBigBlind : null;
  useEffect(() => {
    onLoadReplays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-3 py-6">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close"
        role="button"
        tabIndex={-1}
      />
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold">{me?.name ?? "—"}</div>
            <div className="text-xs text-zinc-500">
              {me?.handle ? `@${me.handle}` : ""} {me?.status && `· ${me.status}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {me?.quote && (
            <p className="text-xs text-zinc-400 italic">"{me.quote}"</p>
          )}

          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Chips</h3>
            <div className="bg-zinc-800/60 rounded p-3 text-sm">
              {selfStackChips != null ? (
                <>
                  <div className="text-yellow-300 font-bold text-lg">
                    {selfStackChips.toLocaleString()}
                  </div>
                  {stackBB != null && (
                    <div className="text-xs text-zinc-400">{stackBB.toFixed(1)} BB</div>
                  )}
                </>
              ) : (
                <div className="text-zinc-500 text-xs">
                  No live stack — join a table to see your chip count.
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Lobby</h3>
            <div className="bg-zinc-800/60 rounded p-3 text-sm">
              {lobby?.inLobby ? (
                <>
                  <div>Position #{lobby.position}</div>
                  {lobby.total != null && (
                    <div className="text-xs text-zinc-400">of {lobby.total} waiting</div>
                  )}
                </>
              ) : (
                <div className="text-zinc-500 text-xs">Not in lobby right now.</div>
              )}
            </div>
          </section>

          <ClaimSection />

          <section>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[10px] uppercase tracking-wide text-zinc-500">
                Recent hands
              </h3>
              <button
                onClick={onLoadReplays}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              >
                refresh
              </button>
            </div>
            {replays == null ? (
              <div className="text-xs text-zinc-500">Loading…</div>
            ) : replays.length === 0 ? (
              <div className="text-xs text-zinc-500">No settled hands yet.</div>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin pr-1">
                {replays.map((h) => {
                  const won = h.chipDelta > 0;
                  const lost = h.chipDelta < 0;
                  return (
                    <li
                      key={h.handId}
                      className="flex items-center gap-2 bg-zinc-800/60 rounded px-2 py-1.5 text-xs"
                    >
                      <span
                        className={`font-mono w-16 text-right shrink-0 ${
                          won ? "text-emerald-300" : lost ? "text-red-300" : "text-zinc-400"
                        }`}
                      >
                        {h.chipDelta >= 0 ? "+" : ""}
                        {h.chipDelta.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-zinc-500 truncate flex-1">
                        won by{" "}
                        <span className="text-zinc-300">
                          {h.winnerHandle ? `@${h.winnerHandle}` : "—"}
                        </span>
                      </span>
                      <a
                        href={h.replayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:underline text-[11px] shrink-0"
                      >
                        replay ↗
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
              Leaderboard
            </h3>
            {board.length === 0 ? (
              <div className="text-zinc-500 text-xs">No leaderboard entries yet.</div>
            ) : (
              <ul className="space-y-2">
                {board.map((b, i) => (
                  <li key={b.arenaId ?? i} className="bg-zinc-800/60 rounded p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm truncate">
                        {b.arenaName ?? b.arenaId ?? "—"}
                      </div>
                      {b.arenaStatus && (
                        <span className="text-[10px] uppercase text-zinc-500">
                          {b.arenaStatus}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-1.5 text-[11px] font-mono">
                      <Stat label="Rank" v={b.rank != null ? `#${b.rank}` : "—"} />
                      <Stat label="Best" v={b.bestRank != null ? `#${b.bestRank}` : "—"} />
                      <Stat label="Score" v={b.totalScore != null ? b.totalScore.toFixed(2) : "—"} />
                    </div>
                    {b.totalSubmissions != null && (
                      <div className="text-[10px] text-zinc-500 mt-1">
                        {b.totalSubmissions} submissions
                        {b.streak != null && ` · streak ${b.streak}`}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            onClick={onClose}
            className="w-full bg-zinc-800 hover:bg-zinc-700 rounded-md py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      </div>
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
  summaryByAgent,
}: {
  table: Table;
  statsByAgent: Record<string, AgentStats | null>;
  summaryByAgent: Record<string, string>;
}) {
  const rows = table.seats
    .filter((s) => s.seatNumber !== table.selfSeatNumber)
    .map((s) => ({ seat: s, stats: statsByAgent[s.agentId] }));
  return (
    <details className="bg-zinc-900/95 border border-zinc-800 rounded-xl" open>
      <summary className="px-3 py-2 text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-zinc-400 cursor-pointer select-none">
        Opponents ({rows.length})
      </summary>
      <ul className="px-3 pb-3 space-y-2">
        {rows.map(({ seat, stats }) => (
          <li key={seat.seatId} className="text-[11px] sm:text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-zinc-200 truncate">
                {seat.agentName || seat.agentHandle}
              </span>
              <span className="text-zinc-500 truncate">@{seat.agentHandle}</span>
            </div>
            {stats?.playingStyle?.archetype && (
              <div className="text-[10px] sm:text-[11px] text-zinc-400">
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
              <div className="text-[10px] sm:text-[11px] text-zinc-500 italic line-clamp-2">"{stats.playingStyle.tagline}"</div>
            )}
            {summaryByAgent[seat.agentId] ? (
              <div className="mt-1 text-[11px] sm:text-xs text-emerald-200/90 bg-emerald-900/15 border border-emerald-800/40 rounded px-2 py-1.5 leading-snug">
                <span className="text-[9px] uppercase tracking-wide text-emerald-400/80 mr-1">AI</span>
                {summaryByAgent[seat.agentId]}
              </div>
            ) : stats ? (
              <div className="mt-1 text-[10px] text-zinc-600 italic">analyzing playstyle…</div>
            ) : null}
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
    </details>
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
