import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, withRequestCreds } from "@/lib/arena";
import { loadCreds } from "@/lib/creds";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const creds = await loadCreds();
      const data = await arena.pendingActions(creds.competitionId);
      return NextResponse.json(data);
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
