"use client";

import { useEffect, useState } from "react";

interface Competition {
  id: string;
  name: string;
  description?: string | null;
  seasonNumber?: number;
  gameType?: string;
  status?: string | null;
  active: boolean;
}

interface Props {
  onRegistered: () => void;
}

export function RegisterForm({ onRegistered }: Props) {
  const [comps, setComps] = useState<Competition[]>([]);
  const [compsLoading, setCompsLoading] = useState(true);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [quote, setQuote] = useState("");
  const [description, setDescription] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCompsLoading(true);
      try {
        const res = await fetch("/api/competitions");
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        const arr: Competition[] = Array.isArray(j.competitions) ? j.competitions : [];
        setComps(arr);
        // default-select first active competition
        const firstActive = arr.find((c) => c.active) ?? arr[0];
        if (firstActive) setCompetitionId(firstActive.id);
      } catch (e) {
        setCompsError((e as Error).message);
      } finally {
        setCompsLoading(false);
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          name: name.trim(),
          quote: quote.trim(),
          description: description.trim(),
          competitionId: competitionId.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // Surface Arena's actual validation/error message when available.
        const payloadMsg =
          j.payload && typeof j.payload === "object" && j.payload && "message" in j.payload
            ? String((j.payload as { message?: unknown }).message)
            : null;
        throw new Error(payloadMsg || j.error || `HTTP ${res.status}`);
      }
      onRegistered();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6">
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-zinc-900/80 backdrop-blur rounded-xl border border-zinc-800 p-5 sm:p-6 shadow-xl space-y-4"
      >
        <div>
          <h1 className="text-xl sm:text-2xl font-bold mb-1">Register a new agent</h1>
          <p className="text-xs sm:text-sm text-zinc-400">
            Creates a fresh agent on dev.fun. The API key is saved to{" "}
            <code>web/.creds.json</code> and never leaves this server.
          </p>
        </div>

        <Field label="Handle" hint="lowercase, no spaces (e.g. my_bot_2026)">
          <input
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            maxLength={50}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Display name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Quote" hint="required, ≤280 chars">
          <input
            required
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            maxLength={280}
            placeholder="e.g. fold less, bluff more"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Description (optional)" hint="≤500 chars">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field
          label="Competition"
          hint={compsLoading ? "loading…" : `${comps.length} Texas Hold'em`}
        >
          {compsError && (
            <p className="text-xs text-red-400 mb-1">Failed to load competitions: {compsError}</p>
          )}
          {comps.length > 0 ? (
            <select
              required
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {comps.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.active}>
                  {c.name}
                  {c.seasonNumber != null && ` · S${c.seasonNumber}`}
                  {c.status && ` · ${c.status}`}
                  {!c.active && " (ended)"}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              placeholder="competition id"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
            />
          )}
          {competitionId && (
            <div className="mt-1 text-[10px] text-zinc-500 font-mono break-all">{competitionId}</div>
          )}
        </Field>

        {err && (
          <div className="text-sm bg-red-950/60 border border-red-900 text-red-200 rounded px-3 py-2 break-words">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !handle || !name || !quote || !competitionId}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-md py-2.5 font-semibold transition"
        >
          {busy ? "Registering…" : "Register agent"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
