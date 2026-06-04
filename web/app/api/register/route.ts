import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, ArenaError } from "@/lib/arena";
import { getBaseUrl, saveWebCreds, tryLoadCreds } from "@/lib/creds";

interface Body {
  handle?: string;
  name?: string;
  quote?: string;
  description?: string;
  competitionId?: string;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body = {};
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

  // Refuse to overwrite an existing credential set without explicit reset.
  const existing = await tryLoadCreds();
  if (existing) {
    return NextResponse.json(
      {
        error:
          "Credentials already exist (web/.creds.json or ../.arena-credentials). Delete those files first if you want to register fresh.",
      },
      { status: 409 },
    );
  }

  try {
    const result = await arena.register({
      handle: body.handle.trim(),
      name: body.name.trim(),
      quote: body.quote?.trim() || "",
      description: body.description?.trim() || "",
    });
    const baseUrl = await getBaseUrl();
    await saveWebCreds({
      baseUrl,
      apiKey: result.apiKey,
      agentId: result.agentId,
      competitionId: body.competitionId.trim(),
    });
    return NextResponse.json({
      ok: true,
      agentId: result.agentId,
      apiKeyPrefix: result.apiKey.slice(0, 16),
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
