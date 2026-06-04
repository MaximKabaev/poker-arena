// Server-side credentials store.
// Holds up to 2 agents in web/.creds.json with one marked active.
// On first read, auto-imports the Python agent (../.arena-credentials + ../.env) if present.

import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const ARENA_CREDS_PATH = path.join(PROJECT_ROOT, ".arena-credentials");
const ARENA_ENV_PATH = path.join(PROJECT_ROOT, ".env");
const WEB_CREDS_PATH = path.join(process.cwd(), ".creds.json");

export const MAX_AGENTS = 2;

export interface AgentRecord {
  agentId: string;
  apiKey: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
  createdAt: string;
  source: "imported" | "registered";
}

export interface CredsStore {
  baseUrl: string;
  activeAgentId: string | null;
  agents: AgentRecord[];
}

export interface ArenaCreds {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  competitionId: string;
}

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readDotenvSafe(p: string): Promise<Record<string, string>> {
  try {
    const out: Record<string, string> = {};
    for (const line of (await fs.readFile(p, "utf8")).split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[t.slice(0, eq).trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let _cachedStore: CredsStore | null = null;
function invalidate() {
  _cachedStore = null;
}

function defaultBaseUrl(envFile: Record<string, string>): string {
  return (
    process.env.ARENA_BASE_URL ||
    envFile.ARENA_BASE_URL ||
    "https://arena.dev.fun"
  ).replace(/\/$/, "");
}

// Reads (and migrates if needed) web/.creds.json, auto-importing the Python
// agent's credentials when the store is missing or empty.
export async function loadStore(): Promise<CredsStore> {
  if (_cachedStore) return _cachedStore;

  const envFile = await readDotenvSafe(ARENA_ENV_PATH);
  const baseUrl = defaultBaseUrl(envFile);

  // Read existing store and migrate legacy single-agent shape.
  const raw = await readJsonSafe<Partial<CredsStore> & {
    apiKey?: string;
    agentId?: string;
    competitionId?: string;
  }>(WEB_CREDS_PATH);

  let store: CredsStore;
  if (raw && Array.isArray(raw.agents)) {
    store = {
      baseUrl: raw.baseUrl || baseUrl,
      activeAgentId: raw.activeAgentId ?? raw.agents[0]?.agentId ?? null,
      agents: raw.agents,
    };
  } else if (raw && raw.apiKey && raw.agentId && raw.competitionId) {
    // legacy single-agent
    const rec: AgentRecord = {
      agentId: raw.agentId,
      apiKey: raw.apiKey,
      competitionId: raw.competitionId,
      createdAt: new Date().toISOString(),
      source: "registered",
    };
    store = { baseUrl: raw.baseUrl || baseUrl, activeAgentId: rec.agentId, agents: [rec] };
    await fs.writeFile(WEB_CREDS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
  } else {
    store = { baseUrl, activeAgentId: null, agents: [] };
  }

  // Auto-import Python-side credentials if the store is empty.
  if (store.agents.length === 0) {
    const py = await readJsonSafe<{ apiKey?: string; agentId?: string }>(ARENA_CREDS_PATH);
    const compId = process.env.COMPETITION_ID || envFile.COMPETITION_ID;
    if (py?.apiKey && py?.agentId && compId) {
      const rec: AgentRecord = {
        agentId: py.agentId,
        apiKey: py.apiKey,
        competitionId: compId,
        agentHandle: envFile.AGENT_HANDLE,
        agentName: envFile.AGENT_NAME,
        createdAt: new Date().toISOString(),
        source: "imported",
      };
      store.agents.push(rec);
      store.activeAgentId = rec.agentId;
      await fs.writeFile(WEB_CREDS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
    }
  }

  _cachedStore = store;
  return store;
}

export async function saveStore(store: CredsStore): Promise<void> {
  await fs.writeFile(WEB_CREDS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
  invalidate();
}

export async function addAgent(rec: AgentRecord): Promise<CredsStore> {
  const store = await loadStore();
  if (store.agents.find((a) => a.agentId === rec.agentId)) return store; // idempotent
  if (store.agents.length >= MAX_AGENTS) {
    throw new Error(`Already at the ${MAX_AGENTS}-agent cap — remove one first.`);
  }
  store.agents.push(rec);
  store.activeAgentId = rec.agentId;
  await saveStore(store);
  return store;
}

export async function selectAgent(agentId: string): Promise<CredsStore> {
  const store = await loadStore();
  if (!store.agents.find((a) => a.agentId === agentId)) {
    throw new Error("Agent not found in store.");
  }
  store.activeAgentId = agentId;
  await saveStore(store);
  return store;
}

export async function removeAgent(agentId: string): Promise<CredsStore> {
  const store = await loadStore();
  store.agents = store.agents.filter((a) => a.agentId !== agentId);
  if (store.activeAgentId === agentId) {
    store.activeAgentId = store.agents[0]?.agentId ?? null;
  }
  await saveStore(store);
  return store;
}

function activeRecord(store: CredsStore): AgentRecord | null {
  if (!store.activeAgentId) return store.agents[0] ?? null;
  return store.agents.find((a) => a.agentId === store.activeAgentId) || store.agents[0] || null;
}

export async function tryLoadCreds(): Promise<ArenaCreds | null> {
  const store = await loadStore();
  const a = activeRecord(store);
  if (!a) return null;
  return {
    baseUrl: store.baseUrl,
    apiKey: a.apiKey,
    agentId: a.agentId,
    competitionId: a.competitionId,
  };
}

export async function loadCreds(): Promise<ArenaCreds> {
  const c = await tryLoadCreds();
  if (!c) {
    throw new Error(
      "No active agent. Register one via the web UI or populate ../.arena-credentials and ../.env.",
    );
  }
  return c;
}

export async function getBaseUrl(): Promise<string> {
  const store = await loadStore();
  return store.baseUrl;
}

// Mask sensitive parts when exposing the store to the client.
export interface AgentPublic {
  agentId: string;
  agentHandle?: string;
  agentName?: string;
  competitionId: string;
  apiKeyPrefix: string;
  createdAt: string;
  source: "imported" | "registered";
  isActive: boolean;
}

export async function listAgentsPublic(): Promise<{
  agents: AgentPublic[];
  activeAgentId: string | null;
  max: number;
}> {
  const store = await loadStore();
  return {
    activeAgentId: store.activeAgentId,
    max: MAX_AGENTS,
    agents: store.agents.map((a) => ({
      agentId: a.agentId,
      agentHandle: a.agentHandle,
      agentName: a.agentName,
      competitionId: a.competitionId,
      apiKeyPrefix: a.apiKey.slice(0, 16),
      createdAt: a.createdAt,
      source: a.source,
      isActive: a.agentId === store.activeAgentId,
    })),
  };
}

export function getAppPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error("APP_PASSWORD env var is required");
  return pw;
}
