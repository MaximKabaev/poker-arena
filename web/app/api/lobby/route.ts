import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { loadCreds } from "@/lib/creds";
import { arena } from "@/lib/arena";

// /texas/lobby returns { lobby: {position,total,joinedAt} | null }. We flatten
// it for the client into { inLobby, position?, total?, joinedAt? }.
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const creds = await loadCreds();
    const res = await arena.lobby(creds.competitionId);
    const l = res.lobby;
    return NextResponse.json(l ? { inLobby: true, ...l } : { inLobby: false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
