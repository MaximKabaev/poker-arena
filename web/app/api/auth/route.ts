import { NextResponse } from "next/server";
import { getAppPassword } from "@/lib/creds";
import { isAuthed, makeToken, setAuthCookie, clearAuthCookie } from "@/lib/session";

export async function GET() {
  return NextResponse.json({ authed: await isAuthed() });
}

export async function POST(req: Request) {
  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const expected = getAppPassword();
  if (!body.password || body.password !== expected) {
    return NextResponse.json({ ok: false, error: "Invalid password" }, { status: 401 });
  }
  await setAuthCookie(makeToken());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
