import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, ArenaError, currentCreds, withRequestCreds } from "@/lib/arena";


export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const creds = currentCreds();
      const res = await arena.join(creds.competitionId);
      return NextResponse.json(res);
    });
  } catch (e) {
    if (e instanceof ArenaError) {
      return NextResponse.json({ error: e.message, payload: e.payload }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
