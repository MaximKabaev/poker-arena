import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena } from "@/lib/arena";

interface CompetitionRaw {
  id?: string;
  name?: string;
  description?: string | null;
  seasonNumber?: number;
  gameType?: string;
  status?: string;
  startAt?: number | null;
  endAt?: number | null;
}

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // /competition/list-all returns { total, data: [...] } with status fields.
    const res = await arena.listAllCompetitions(100, 0);
    const items = (res?.data || []) as CompetitionRaw[];
    const holdem = items.filter((c) => c.gameType === "TexasHoldem" && c.id);
    // sort: active first, then by season desc
    holdem.sort((a, b) => {
      const aActive = isActiveStatus(a.status) ? 0 : 1;
      const bActive = isActiveStatus(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0);
    });
    return NextResponse.json({
      competitions: holdem.map((c) => ({
        id: c.id!,
        name: c.name ?? c.id!,
        description: c.description ?? null,
        seasonNumber: c.seasonNumber,
        gameType: c.gameType,
        status: c.status ?? null,
        active: isActiveStatus(c.status),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

function isActiveStatus(s: string | undefined | null): boolean {
  if (!s) return false;
  return s.toLowerCase() === "active";
}
