import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena } from "@/lib/arena";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const me = await arena.me();
    return NextResponse.json(me);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
