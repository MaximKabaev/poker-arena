"use client";

import { useEffect, useState } from "react";

interface Competition {
  competitionId?: string;
  id?: string;
  name?: string;
  title?: string;
  [k: string]: unknown;
}

interface Props {
  onRegistered: () => void;
}

export function RegisterForm({ onRegistered }: Props) {
  const [comps, setComps] = useState<Competition[]>([]);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [quote, setQuote] = useState("");
  const [description, setDescription] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/competitions");
        const j = await res.json();
        const arr: Competition[] = Array.isArray(j)
          ? j
          : Array.isArray((j as { competitions?: unknown }).competitions)
          ? ((j as { competitions: Competition[] }).competitions)
          : [];
        setComps(arr);
        const first = arr[0]?.competitionId || arr[0]?.id;
        if (first) setCompetitionId(first);
      } catch (e) {
        setErr((e as Error).message);
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
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onRegistered();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-zinc-900/80 backdrop-blur rounded-xl border border-zinc-800 p-6 shadow-xl space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold mb-1">Register a new agent</h1>
          <p className="text-sm text-zinc-400">
            No credentials found. Create a fresh agent — the API key is saved to{" "}
            <code>web/.creds.json</code> and never leaves this server.
          </p>
        </div>

        <Field label="Handle" hint="lowercase, no spaces (e.g. my_bot_2026)">
          <input
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Display name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Quote (optional)">
          <input
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            maxLength={200}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </Field>

        <Field label="Competition">
          {comps.length > 0 ? (
            <select
              required
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {comps.map((c) => {
                const id = c.competitionId || c.id || "";
                const label = c.name || c.title || id;
                return (
                  <option key={id} value={id}>
                    {label} — {id}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              required
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              placeholder="competition id (e.g. cmpy2qy65002ud9ej6b7jjq0l)"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
            />
          )}
        </Field>

        {err && <p className="text-sm text-red-400">{err}</p>}

        <button
          type="submit"
          disabled={busy || !handle || !name || !competitionId}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-md py-2 font-semibold transition"
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
