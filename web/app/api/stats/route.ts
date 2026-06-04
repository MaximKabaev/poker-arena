import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { loadCreds } from "@/lib/creds";
import { arena } from "@/lib/arena";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  try {
    const creds = await loadCreds();
    const stats = await arena.agentStats(creds.competitionId, agentId);
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
