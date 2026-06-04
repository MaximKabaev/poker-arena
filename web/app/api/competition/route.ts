import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { loadCreds } from "@/lib/creds";
import { arena } from "@/lib/arena";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const creds = await loadCreds();
    const info = await arena.competition(creds.competitionId);
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
