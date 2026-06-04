import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/session";
import { arena } from "@/lib/arena";
import { promises as fs } from "node:fs";
import path from "node:path";

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

// Best-effort: try list-active first (lighter; no query params), fall back to
// list-all, and always include a defaultCompetitionId from ../.env so the user
// can still register if Arena's discovery endpoints are down.
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const defaultCompetitionId = await readDefaultCompetitionId();

  const sources: Array<{ label: string; run: () => Promise<CompetitionRaw[]> }> = [
    {
      label: "list-active",
      run: async () => (await arena.listActiveCompetitions()) as CompetitionRaw[],
    },
    {
      label: "list-all",
      run: async () => {
        const r = (await arena.listAllCompetitions(100, 0)) as { data?: CompetitionRaw[] };
        return r?.data ?? [];
      },
    },
  ];

  const errors: string[] = [];
  for (const src of sources) {
    try {
      const items = await src.run();
      const holdem = items
        .filter((c) => c.gameType === "TexasHoldem" && c.id)
        .map((c) => ({
          id: c.id!,
          name: c.name ?? c.id!,
          description: c.description ?? null,
          seasonNumber: c.seasonNumber,
          gameType: c.gameType,
          status: c.status ?? "Active",
          active: !c.status || c.status.toLowerCase() === "active",
        }));
      holdem.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0);
      });
      return NextResponse.json({
        competitions: holdem,
        source: src.label,
        defaultCompetitionId,
      });
    } catch (e) {
      errors.push(`${src.label}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json(
    {
      competitions: [],
      defaultCompetitionId,
      error: `competition discovery failed — ${errors.join(" | ")}`,
    },
    { status: 200 }, // 200 so the form still loads; UI handles `error` field.
  );
}

async function readDefaultCompetitionId(): Promise<string | null> {
  if (process.env.COMPETITION_ID) return process.env.COMPETITION_ID;
  try {
    const txt = await fs.readFile(path.resolve(process.cwd(), "..", ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      if (k !== "COMPETITION_ID") continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v || null;
    }
  } catch {}
  return null;
}
