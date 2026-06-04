"use client";

import { useEffect, useState } from "react";

interface ClaimStatus {
  claimed: boolean;
  hasClaimToken: boolean;
  claimToken: string | null;
  claimUrl: string | null;
  xHandle: string | null;
  xVerifiedAt: number | null;
  status: string;
}

interface ClaimInit {
  claimToken: string;
  claimUrl: string;
  instructions: string;
}

// Renders the dev.fun X-claim status + verification flow.
// Polls /api/claim every 5s while mounted so the UI updates as soon as the
// user finishes verifying on the dev.fun dashboard.
export function ClaimSection() {
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [init, setInit] = useState<ClaimInit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/claim");
        const j = (await res.json()) as ClaimStatus | { error: string };
        if (cancelled) return;
        if ("error" in j) {
          setErr(j.error);
          return;
        }
        setErr(null);
        setStatus(j);
        // If Arena already has a token issued, surface it without a fresh POST.
        if (!init && j.claimUrl && j.claimToken && !j.claimed) {
          setInit({ claimToken: j.claimToken, claimUrl: j.claimUrl, instructions: "" });
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [init]);

  async function startClaim() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/claim", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setInit(j as ClaimInit);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyUrl() {
    if (!init?.claimUrl) return;
    navigator.clipboard?.writeText(init.claimUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
        X account claim
      </h3>

      {!status && !err && (
        <div className="bg-zinc-800/60 rounded p-3 text-xs text-zinc-500">Loading…</div>
      )}

      {status?.claimed && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 text-emerald-100 rounded p-3 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <span>✓ Claimed</span>
            {status.xHandle && (
              <a
                href={`https://x.com/${status.xHandle}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-300 hover:underline"
              >
                @{status.xHandle}
              </a>
            )}
          </div>
          {status.xVerifiedAt && (
            <div className="text-[11px] text-emerald-200/70 mt-0.5">
              Verified {new Date(status.xVerifiedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {status && !status.claimed && (
        <div className="bg-zinc-800/60 rounded p-3 space-y-2">
          <div className="text-xs text-zinc-400">
            This agent is <span className="text-amber-300">not yet linked</span> to an X
            account. Link it on dev.fun to make it eligible for prizes and to show on the
            public leaderboard.
          </div>

          {!init && (
            <button
              onClick={startClaim}
              disabled={busy}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md py-2 text-sm font-semibold"
            >
              {busy ? "Generating link…" : "Start claim"}
            </button>
          )}

          {init && (
            <div className="space-y-2">
              <div className="text-xs text-zinc-300">
                Open this URL, sign in with X, and follow the prompts. Status here will
                refresh automatically.
              </div>
              <div className="flex gap-2">
                <a
                  href={init.claimUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex-1 text-center bg-blue-600 hover:bg-blue-500 rounded-md py-2 text-sm font-semibold"
                >
                  Open dev.fun dashboard ↗
                </a>
                <button
                  onClick={copyUrl}
                  className="px-3 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs"
                  title="Copy claim URL"
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
              <details>
                <summary className="text-[11px] text-zinc-500 cursor-pointer select-none">
                  show claim URL + token
                </summary>
                <div className="mt-1 text-[10px] font-mono text-zinc-400 break-all bg-zinc-900/60 rounded p-2">
                  <div>{init.claimUrl}</div>
                  <div className="mt-1 text-zinc-600">token: {init.claimToken}</div>
                </div>
              </details>
              {init.instructions && (
                <div className="text-[11px] text-zinc-500 whitespace-pre-wrap">
                  {init.instructions}
                </div>
              )}
              <button
                onClick={startClaim}
                disabled={busy}
                className="w-full text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                {busy ? "Regenerating…" : "regenerate token"}
              </button>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="mt-2 text-xs text-red-400 break-words">Claim error: {err}</div>
      )}
    </section>
  );
}
