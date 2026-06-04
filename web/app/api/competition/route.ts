import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, currentCreds, withRequestCreds } from "@/lib/arena";


export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const creds = currentCreds();
      const info = await arena.competition(creds.competitionId);
      return NextResponse.json(info);
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
