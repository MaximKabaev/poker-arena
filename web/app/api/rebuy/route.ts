import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, ArenaError, withRequestCreds } from "@/lib/arena";
import { loadCreds } from "@/lib/creds";

interface Body {
  txHash?: string;
}

// POST /api/rebuy — top up the active (or per-window) agent's bankroll.
// First call (no txHash) usually returns 402 with payment requirements. The
// client surfaces those so the user can pay on-chain, then retries with the
// resulting txHash.
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Body = {};
  try {
    body = await req.json();
  } catch {}
  try {
    return await withRequestCreds(req, async () => {
      const creds = await loadCreds();
      const r = await arena.rebuy(creds.competitionId, body.txHash);
      return NextResponse.json({ ok: true, ...r });
    });
  } catch (e) {
    if (e instanceof ArenaError) {
      // 402 carries the payment requirements as payload — forward verbatim.
      return NextResponse.json(
        { error: e.message, status: e.status, payload: e.payload },
        { status: e.status },
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
