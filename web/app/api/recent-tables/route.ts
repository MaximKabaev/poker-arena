import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { loadCreds } from "@/lib/creds";
import { arena } from "@/lib/arena";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") ?? "5")));
  try {
    const creds = await loadCreds();
    const data = await arena.recentTables(creds.competitionId, limit);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
