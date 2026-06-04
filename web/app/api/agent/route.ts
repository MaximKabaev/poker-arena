import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena } from "@/lib/arena";

// Normalize the live `/agent/me` shape ({id, ...}) to {agentId, ...} for the UI.
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const m = await arena.me();
    return NextResponse.json({
      agentId: m.id,
      handle: m.handle,
      name: m.name,
      quote: m.quote ?? null,
      status: m.status,
      leaderboard: m.leaderboard ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
