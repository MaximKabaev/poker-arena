import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { addAgent, listAgentsPublic, MAX_AGENTS } from "@/lib/creds";
import { arena, ArenaError } from "@/lib/arena";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const data = await listAgentsPublic();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

interface RegisterBody {
  handle?: string;
  name?: string;
  quote?: string;
  description?: string;
  competitionId?: string;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: RegisterBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.handle?.trim() || !body.name?.trim() || !body.competitionId?.trim()) {
    return NextResponse.json(
      { error: "handle, name, and competitionId are required" },
      { status: 400 },
    );
  }

  // Check cap before hitting the Arena API.
  const current = await listAgentsPublic();
  if (current.agents.length >= MAX_AGENTS) {
    return NextResponse.json(
      { error: `Cap of ${MAX_AGENTS} agents reached. Remove one first.` },
      { status: 409 },
    );
  }

  try {
    const r = await arena.register({
      handle: body.handle.trim(),
      name: body.name.trim(),
      quote: body.quote?.trim() || "",
      description: body.description?.trim() || "",
    });
    const store = await addAgent({
      agentId: r.agentId,
      apiKey: r.apiKey,
      agentHandle: body.handle.trim(),
      agentName: body.name.trim(),
      competitionId: body.competitionId.trim(),
      createdAt: new Date().toISOString(),
      source: "registered",
    });
    return NextResponse.json({
      ok: true,
      agentId: r.agentId,
      apiKeyPrefix: r.apiKey.slice(0, 16),
      activeAgentId: store.activeAgentId,
    });
  } catch (e) {
    if (e instanceof ArenaError) {
      return NextResponse.json(
        { error: e.message, status: e.status, payload: e.payload },
        { status: e.status },
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
