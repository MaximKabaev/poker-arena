"use client";

// Per-window agent context. Reads `?a=<agentId>` from the URL once on first
// access; later tabs can be opened with `?a=<id>` to control a different agent
// simultaneously without affecting the global "active" agent in the store.

let cachedAgentId: string | null | undefined = undefined;

function readAgentIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  return p.get("a");
}

export function getWindowAgentId(): string | null {
  if (cachedAgentId !== undefined) return cachedAgentId;
  cachedAgentId = readAgentIdFromUrl();
  return cachedAgentId;
}

export function setWindowAgentId(agentId: string | null): void {
  cachedAgentId = agentId;
}

// Drop-in replacement for fetch that always carries the window's chosen
// agent id via the `x-agent-id` header. Server routes use this header to
// scope every Arena call to that specific agent (AsyncLocalStorage context).
export function clientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const agentId = getWindowAgentId();
  if (!agentId) return fetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set("x-agent-id", agentId);
  return fetch(input, { ...init, headers });
}

// Open the same site in a new browser window scoped to a specific agent.
export function openWindowForAgent(agentId: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("a", agentId);
  // Remove any other state-bearing params if needed.
  window.open(url.toString(), "_blank", "noopener");
}

export function urlForAgent(agentId: string): string {
  if (typeof window === "undefined") return `/?a=${agentId}`;
  const url = new URL(window.location.href);
  url.searchParams.set("a", agentId);
  return url.toString();
}
