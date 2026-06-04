import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena, ArenaError } from "@/lib/arena";
import type { ActionRequest } from "@/lib/types";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Partial<ActionRequest> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.tableId || !body.action) {
    return NextResponse.json({ error: "tableId and action required" }, { status: 400 });
  }
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: "message is required (1-500 chars)" }, { status: 400 });
  }
  try {
    const result = await arena.submitAction({
      tableId: body.tableId,
      action: body.action,
      amount: body.amount ?? null,
      message: body.message,
      reasoning: body.reasoning,
    });
    return NextResponse.json({ ok: true, result });
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
