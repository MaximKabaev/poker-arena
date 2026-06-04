// Server-only: turns raw `texas/agent-stats` into a 1–2 sentence playstyle
// summary via the OpenAI Chat Completions API. Cached in-memory per agentId.

import type { AgentStats } from "./types";
import { promises as fs } from "node:fs";
import path from "node:path";

const SUMMARY_CACHE = new Map<string, { summary: string; sampleSize: number; cachedAt: number }>();

interface OpenAIChoice {
  message?: { content?: string };
}
interface OpenAIResponse {
  choices?: OpenAIChoice[];
  error?: { message?: string };
}

async function readKeyFromParentEnv(): Promise<string | null> {
  try {
    const txt = await fs.readFile(path.resolve(process.cwd(), "..", ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      if (t.slice(0, eq).trim() !== "OPENAI_API_KEY") continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v || null;
    }
  } catch {}
  return null;
}

let _key: string | null | undefined = undefined;
async function getKey(): Promise<string | null> {
  if (_key !== undefined) return _key;
  _key = process.env.OPENAI_API_KEY || (await readKeyFromParentEnv());
  return _key;
}

function pct(v: number | null | undefined): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}
function num(v: number | null | undefined): string {
  return v == null ? "n/a" : v.toFixed(2);
}

function buildPrompt(stats: AgentStats): string {
  const ps = stats.playingStyle ?? {};
  const lines = [
    `An opponent at a no-limit Texas Hold'em table has the following stats:`,
    `- Hands observed: ${stats.sampleSize ?? "n/a"}`,
    `- VPIP (voluntarily put money in pot): ${pct(stats.vpip)}`,
    `- PFR (preflop raise rate): ${pct(stats.pfr)}`,
    `- 3-bet %: ${pct(stats.threeBetPct)}`,
    `- Aggression factor (AF): ${num(stats.af)} (<1 passive, 1–2 balanced, >2 aggressive)`,
    `- Bluff %: ${pct(stats.bluffPct)}`,
    `- WTSD (went to showdown): ${pct(stats.wtsd)}`,
    `- WSD (won at showdown): ${pct(stats.wsd)}`,
    `- Style: ${ps.tightness ?? "?"} / ${ps.aggression ?? "?"}`,
    `- Archetype: ${ps.archetype ?? "?"}`,
    ``,
    `In 1–2 short sentences (max 50 words), describe their playstyle in plain English and how to exploit them. Be concrete and avoid restating the numbers. If sample size is small or stats are null, say so briefly.`,
  ];
  return lines.join("\n");
}

export interface SummaryResult {
  summary: string;
  fromCache: boolean;
  model: string;
}

export async function summarizeOpponent(
  agentId: string,
  stats: AgentStats,
): Promise<SummaryResult> {
  const model = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";

  // Cache key by agentId; invalidate if sample size has grown materially.
  const cached = SUMMARY_CACHE.get(agentId);
  if (cached) {
    const grew = (stats.sampleSize ?? 0) >= cached.sampleSize + 25;
    if (!grew) {
      return { summary: cached.summary, fromCache: true, model };
    }
  }

  const key = await getKey();
  if (!key) {
    return {
      summary: "(LLM summary unavailable — OPENAI_API_KEY not set on the server.)",
      fromCache: false,
      model,
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a concise no-limit Texas Hold'em coach. Always answer in 1–2 short sentences, max 50 words, plain prose, no markdown.",
        },
        { role: "user", content: buildPrompt(stats) },
      ],
      max_tokens: 120,
      temperature: 0.6,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: OpenAIResponse;
  try {
    parsed = JSON.parse(text) as OpenAIResponse;
  } catch {
    throw new Error(`openai: non-json response (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`openai ${res.status}: ${parsed.error?.message || text.slice(0, 200)}`);
  }
  const summary = parsed.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("openai: empty completion");

  SUMMARY_CACHE.set(agentId, {
    summary,
    sampleSize: stats.sampleSize ?? 0,
    cachedAt: Date.now(),
  });
  return { summary, fromCache: false, model };
}
