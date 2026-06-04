// Server-side credentials & claim state.
// Precedence for credentials:
//   1. web/.creds.json (written by the in-app registration flow)
//   2. web/.env.local (process.env)
//   3. ../.arena-credentials and ../.env (the Python agent's files)
// Claim state is persisted at web/.claim.json so the user only claims once.

import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const ARENA_CREDS_PATH = path.join(PROJECT_ROOT, ".arena-credentials");
const ARENA_ENV_PATH = path.join(PROJECT_ROOT, ".env");
const WEB_CREDS_PATH = path.join(process.cwd(), ".creds.json");
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

interface WebCredsFile {
  baseUrl?: string;
  apiKey?: string;
  agentId?: string;
  competitionId?: string;
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

function invalidateCache() {
  _cached = null;
}

export async function getBaseUrl(): Promise<string> {
  const envFile = await readDotenvSafe(ARENA_ENV_PATH);
  const web = await readJsonSafe<WebCredsFile>(WEB_CREDS_PATH);
  return (
    web?.baseUrl ||
    process.env.ARENA_BASE_URL ||
    envFile.ARENA_BASE_URL ||
    "https://arena.dev.fun"
  ).replace(/\/$/, "");
}

export async function tryLoadCreds(): Promise<ArenaCreds | null> {
  if (_cached) return _cached;

  const webCreds = await readJsonSafe<WebCredsFile>(WEB_CREDS_PATH);
  const envFile = await readDotenvSafe(ARENA_ENV_PATH);
  const arenaCreds = await readJsonSafe<{ apiKey?: string; agentId?: string }>(
    ARENA_CREDS_PATH,
  );

  const baseUrl = (
    webCreds?.baseUrl ||
    process.env.ARENA_BASE_URL ||
    envFile.ARENA_BASE_URL ||
    "https://arena.dev.fun"
  ).replace(/\/$/, "");

  const apiKey =
    webCreds?.apiKey ||
    process.env.ARENA_API_KEY ||
    arenaCreds?.apiKey ||
    envFile.ARENA_API_KEY ||
    "";
  const agentId =
    webCreds?.agentId ||
    process.env.ARENA_AGENT_ID ||
    arenaCreds?.agentId ||
    envFile.ARENA_AGENT_ID ||
    "";
  const competitionId =
    webCreds?.competitionId ||
    process.env.COMPETITION_ID ||
    envFile.COMPETITION_ID ||
    "";

  if (!apiKey || !agentId || !competitionId) return null;

  _cached = { baseUrl, apiKey, agentId, competitionId };
  return _cached;
}

export async function loadCreds(): Promise<ArenaCreds> {
  const c = await tryLoadCreds();
  if (!c) {
    throw new Error(
      "Missing arena credentials. Register an agent through the web UI or populate ../.arena-credentials and ../.env.",
    );
  }
  return c;
}

export async function saveWebCreds(c: ArenaCreds): Promise<void> {
  await fs.writeFile(WEB_CREDS_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
  invalidateCache();
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
