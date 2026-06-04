// Dev.fun X-claim flow (NOT the old internal "have-you-confirmed-this-bot" gate).
// GET  → claim status (claimed / xHandle / claimUrl)
// POST → init a fresh claim token + url for verification on dev.fun

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, ArenaError, withRequestCreds } from "@/lib/arena";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const s = await arena.claimStatus();
      return NextResponse.json(s);
    });
  } catch (e) {
    if (e instanceof ArenaError) {
      return NextResponse.json({ error: e.message, payload: e.payload }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const r = await arena.claimInit();
      return NextResponse.json(r);
    });
  } catch (e) {
    if (e instanceof ArenaError) {
      return NextResponse.json({ error: e.message, payload: e.payload }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
