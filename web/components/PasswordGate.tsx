"use client";

import { useState } from "react";

interface Props {
  onAuthed: () => void;
}

export function PasswordGate({ onAuthed }: Props) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onAuthed();
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
        className="w-full max-w-sm bg-zinc-900/80 backdrop-blur rounded-xl border border-zinc-800 p-6 shadow-xl"
      >
        <h1 className="text-2xl font-bold mb-1">Poker Arena</h1>
        <p className="text-sm text-zinc-400 mb-6">Enter the access password to continue.</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-base outline-none focus:border-blue-500"
        />
        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy || !pw}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md py-2 font-semibold transition"
        >
          {busy ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
