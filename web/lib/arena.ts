// Server-side Arena HTTP client. Mirrors src/agent/arena_client.py.
// All calls go through here so the API key stays on the server.

import { getBaseUrl, loadCreds } from "./creds";
import type {
  ActionRequest,
  AgentMeRaw,
  AgentStats,
  LobbyState,
  RecentTable,
  Table,
} from "./types";

export interface RegisterRequest {
  handle: string;
  name: string;
  quote?: string;
  description?: string;
}

export interface RegisterResponse {
  apiKey: string;
  agentId: string;
  [k: string]: unknown;
}

const ARENA_PREFIX = "/api/arena";

export class ArenaError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(`[${status}] ${message}`);
    this.status = status;
    this.payload = payload;
  }
}

async function call<T>(
  method: "GET" | "POST" | "PATCH",
  pathSuffix: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const creds = await loadCreds();
  const url = new URL(`${creds.baseUrl}${ARENA_PREFIX}${pathSuffix}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    "x-arena-api-key": creds.apiKey,
    accept: "application/json",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const msg =
      (typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : null) || res.statusText || "request failed";
    throw new ArenaError(res.status, msg, parsed);
  }
  return parsed as T;
}

// Call the Arena API without requiring stored credentials.
// Used for registration and public discovery (list competitions, etc.).
async function callPublic<T>(
  method: "GET" | "POST",
  pathSuffix: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const baseUrl = await getBaseUrl();
  const url = new URL(`${baseUrl}${ARENA_PREFIX}${pathSuffix}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const msg =
      (typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : null) || res.statusText || "request failed";
    throw new ArenaError(res.status, msg, parsed);
  }
  return parsed as T;
}

export const arena = {
  // ----- credential-less calls -----
  register: (req: RegisterRequest) =>
    callPublic<RegisterResponse>("POST", "/auth/register", {
      body: {
        handle: req.handle,
        name: req.name,
        quote: req.quote ?? "",
        description: req.description ?? "",
      },
    }),
  listActiveCompetitions: () =>
    callPublic<unknown>("GET", "/competition/list-active"),
  listAllCompetitions: (limit = 50, offset = 0) =>
    callPublic<{ total: number; data: unknown[] }>("GET", "/competition/list-all", {
      query: { limit: String(limit), offset: String(offset) },
    }),

  // ----- discovery / identity -----
  me: () => call<AgentMeRaw>("GET", "/agent/me"),

  // ----- X-claim flow (link agent to your X account on dev.fun) -----
  claimStatus: () =>
    call<{
      claimed: boolean;
      hasClaimToken: boolean;
      claimToken: string | null;
      claimUrl: string | null;
      xHandle: string | null;
      xVerifiedAt: number | null;
      status: string;
    }>("GET", "/auth/claim/status"),
  claimInit: () =>
    call<{ claimToken: string; claimUrl: string; instructions: string }>(
      "POST",
      "/auth/claim/init",
    ),
  introspection: () => call<unknown>("GET", "/__introspection"),
  competition: async (competitionId: string) =>
    call<unknown>("GET", "/competition", { query: { competitionId } }),
  leaderboard: (competitionId: string, limit = 50) =>
    call<unknown>("GET", "/competition/leaderboard", {
      query: { competitionId, limit: String(limit) },
    }),

  // ----- texas hold'em -----
  join: (competitionId: string, txHash?: string) =>
    call<{ kind: string; [k: string]: unknown }>("POST", "/texas/join", {
      body: txHash ? { competitionId, txHash } : { competitionId },
    }),
  lobby: (competitionId: string) =>
    call<{ lobby: LobbyState | null }>("GET", "/texas/lobby", { query: { competitionId } }),
  pendingActions: (competitionId: string) =>
    call<{ tables: Table[] }>("GET", "/texas/pending-actions", {
      query: { competitionId },
    }),
  submitAction: (req: ActionRequest) => {
    const body: Record<string, unknown> = {
      tableId: req.tableId,
      action: req.action,
      message: (req.message || "gg").slice(0, 500),
    };
    if (req.amount != null && (req.action === "bet" || req.action === "raise" || req.action === "all-in")) {
      body.amount = req.amount;
    }
    if (req.reasoning) body.reasoning = req.reasoning.slice(0, 150);
    return call<unknown>("POST", "/texas/action", { body });
  },
  agentStats: (competitionId: string, agentId: string) =>
    call<AgentStats>("GET", "/texas/agent-stats", {
      query: { competitionId, agentId },
    }),
  recentTables: (competitionId: string, limit = 20) =>
    call<{ total: number; data: RecentTable[] }>("GET", "/texas/recent-tables", {
      query: { competitionId, limit: String(limit) },
    }),
};
