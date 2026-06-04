import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { selectAgent } from "@/lib/creds";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { agentId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  try {
    const store = await selectAgent(body.agentId);
    return NextResponse.json({ ok: true, activeAgentId: store.activeAgentId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
