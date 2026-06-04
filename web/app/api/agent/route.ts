import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, withRequestCreds } from "@/lib/arena";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await withRequestCreds(req, async () => {
      const m = await arena.me();
      return NextResponse.json({
        agentId: m.id,
        handle: m.handle,
        name: m.name,
        quote: m.quote ?? null,
        status: m.status,
        leaderboard: m.leaderboard ?? [],
      });
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
