// Server-side credentials & claim state.
// Defaults: read from ../.arena-credentials and ../.env (the Python agent's files).
// Overrides: web/.env.local (ARENA_API_KEY, ARENA_AGENT_ID, COMPETITION_ID, ARENA_BASE_URL).
// Claim state is persisted at web/.claim.json so the user only claims once.

import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const ARENA_CREDS_PATH = path.join(PROJECT_ROOT, ".arena-credentials");
const ARENA_ENV_PATH = path.join(PROJECT_ROOT, ".env");
const CLAIM_PATH = path.join(process.cwd(), ".claim.json");

export interface ArenaCreds {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  competitionId: string;
}

export interface ClaimRecord {
  claimedAt: string;
  agentId: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
}

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function readDotenvSafe(p: string): Promise<Record<string, string>> {
  try {
    const txt = await fs.readFile(p, "utf8");
    const out: Record<string, string> = {};
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let _cached: ArenaCreds | null = null;

export async function loadCreds(): Promise<ArenaCreds> {
  if (_cached) return _cached;

  const envFile = await readDotenvSafe(ARENA_ENV_PATH);
  const arenaCreds = await readJsonSafe<{
    apiKey?: string;
    agentId?: string;
  }>(ARENA_CREDS_PATH);

  const baseUrl =
    process.env.ARENA_BASE_URL || envFile.ARENA_BASE_URL || "https://arena.dev.fun";
  const apiKey = process.env.ARENA_API_KEY || arenaCreds?.apiKey || envFile.ARENA_API_KEY || "";
  const agentId =
    process.env.ARENA_AGENT_ID || arenaCreds?.agentId || envFile.ARENA_AGENT_ID || "";
  const competitionId =
    process.env.COMPETITION_ID || envFile.COMPETITION_ID || "";

  if (!apiKey || !agentId || !competitionId) {
    throw new Error(
      `Missing arena credentials. apiKey=${!!apiKey} agentId=${!!agentId} competitionId=${!!competitionId}. ` +
        `Set web/.env.local or ensure ${ARENA_CREDS_PATH} and ${ARENA_ENV_PATH} exist.`,
    );
  }

  _cached = { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, agentId, competitionId };
  return _cached;
}

export async function getClaim(): Promise<ClaimRecord | null> {
  return readJsonSafe<ClaimRecord>(CLAIM_PATH);
}

export async function setClaim(rec: ClaimRecord): Promise<void> {
  await fs.writeFile(CLAIM_PATH, JSON.stringify(rec, null, 2), { mode: 0o600 });
}

export function getAppPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error("APP_PASSWORD env var is required");
  return pw;
}
