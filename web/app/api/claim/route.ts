import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { loadCreds, tryLoadCreds, getClaim, setClaim } from "@/lib/creds";
import { arena } from "@/lib/arena";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claim = await getClaim();
  if (claim) return NextResponse.json({ claimed: true, ...claim });

  // No credentials at all → UI should offer registration.
  const creds = await tryLoadCreds();
  if (!creds) {
    return NextResponse.json({ claimed: false, needsRegistration: true });
  }

  // Surface the agent that *would* be claimed for confirmation in the UI.
  try {
    const me = await arena.me();
    return NextResponse.json({
      claimed: false,
      candidate: {
        agentId: me.agentId,
        agentHandle: (me as { handle?: string }).handle,
        agentName: (me as { name?: string }).name,
        competitionId: creds.competitionId,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { claimed: false, error: (e as Error).message },
      { status: 200 },
    );
  }
}

export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const creds = await loadCreds();
  const me = await arena.me();
  const record = {
    claimedAt: new Date().toISOString(),
    agentId: me.agentId,
    agentHandle: (me as { handle?: string }).handle,
    agentName: (me as { name?: string }).name,
    competitionId: creds.competitionId,
  };
  await setClaim(record);
  return NextResponse.json({ claimed: true, ...record });
}
