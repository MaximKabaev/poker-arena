"""YAML-flow reasoning builder with proper overflow handling.

Per the starter kit's `references/reasoning-yaml.md`:
- Hard cap 150 chars (server returns 400 on overflow)
- Soft cap ~130 chars for safety
- DO NOT blind-slice — produces broken YAML.
- Fall back to a known-valid short object instead.
"""

from __future__ import annotations

HARD_CAP = 150
FALLBACK = '{vr: "std", ke: "legal", pp: "pot control"}'  # 47 chars


def build(parts: dict[str, str]) -> str:
    """Serialize parts as YAML flow style; fall back if > 150 chars."""
    pieces = [f"{k}: {v}" for k, v in parts.items() if v]
    s = "{" + ", ".join(pieces) + "}"
    return s if len(s) <= HARD_CAP else FALLBACK


def sanitize(reasoning: str | None) -> str:
    """For externally-sourced reasoning (LLM output): trust if ≤150, else fallback."""
    if not reasoning:
        return FALLBACK
    r = reasoning.strip()
    return r if len(r) <= HARD_CAP else FALLBACK
