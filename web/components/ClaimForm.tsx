"use client";

import { useEffect, useState } from "react";

interface Candidate {
  agentId: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
}

interface Props {
  onClaimed: () => void;
}

export function ClaimForm({ onClaimed }: Props) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/claim");
        const j = await res.json();
        if (cancelled) return;
        if (j.error) setErr(j.error);
        if (j.claimed) onClaimed();
        else if (j.candidate) setCandidate(j.candidate);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onClaimed]);

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/claim", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onClaimed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-zinc-900/80 backdrop-blur rounded-xl border border-zinc-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold mb-1">Claim your agent</h1>
        <p className="text-sm text-zinc-400 mb-6">
          One-time confirmation. After this, the site is locked to this bot.
        </p>

        {!candidate && !err && (
          <p className="text-zinc-400">Loading agent identity...</p>
        )}

        {candidate && (
          <div className="space-y-3 mb-6">
            <Row k="Name" v={candidate.agentName || "—"} />
            <Row k="Handle" v={candidate.agentHandle ? `@${candidate.agentHandle}` : "—"} />
            <Row k="Agent ID" v={<code className="text-xs">{candidate.agentId}</code>} />
            <Row k="Competition" v={<code className="text-xs">{candidate.competitionId}</code>} />
          </div>
        )}

        {err && <p className="text-sm text-red-400 mb-4">{err}</p>}

        <button
          onClick={claim}
          disabled={!candidate || busy}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md py-2 font-semibold transition"
        >
          {busy ? "Claiming..." : "Claim this agent"}
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-zinc-400">{k}</span>
      <span className="text-zinc-100 text-right">{v}</span>
    </div>
  );
}
