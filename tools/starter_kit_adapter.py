"""Adapter so dev.fun's starter-kit CLI can drive our decide().

Usage (from project root, the starter-kit/ subdir was cloned earlier):

    cd starter-kit
    uv sync
    uv run python -m examples.cli selfplay --hands 200 \\
        --agent ../tools/starter_kit_adapter.py

    # Or after installing the entry-point:
    pokerkit selfplay --hands 200 --agent ../tools/starter_kit_adapter.py

KNOWN LIMITATIONS
- The starter-kit selfplay emits a MINIMAL table dict (no competitionId,
  no recentEvents, no blind events). We fill missing fields with defaults
  and synthesize BlindPosted events assuming the hero seat is on the BTN.
  selfplay rotates the button each hand but does not expose its position,
  so on hands where hero isn't actually BTN our preflop position labels
  will be wrong → L1 ranges will be off → L2 fires more than it should.
- selfplay opponents are simple heuristics (random / tight-passive /
  loose-passive / always-call), NOT the DeepCFR reference panel. Per
  dev.fun docs this is for bug-catching only, not score calibration.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))

from agent.config import Settings, load_style  # noqa: E402
from agent.context import DecisionContext  # noqa: E402
from agent.decide import decide as _decide_async, safe_default  # noqa: E402
from agent.opponents import OpponentStatsCache  # noqa: E402
from agent.state import Table  # noqa: E402

_settings = Settings()
_style = load_style()
_db_path = Path("/tmp/poker_arena_selfplay.sqlite")
_cache = OpponentStatsCache(_db_path)
_ctx = DecisionContext(settings=_settings, cache=_cache, style=_style)
_loop = asyncio.new_event_loop()


def _enrich(table: dict) -> dict:
    """Fill missing fields so Table.model_validate succeeds on selfplay dicts."""
    out = dict(table)
    seats_in = list(table.get("seats", []))
    hero_seat_num = table.get("selfSeatNumber")

    out.setdefault("competitionId", "selfplay")
    out.setdefault("tableNumber", 0)
    out.setdefault("status", "Active")
    out.setdefault("currentBet", 0)
    out.setdefault("minRaiseTo", None)
    out.setdefault("smallBlindChips", 1)
    out.setdefault("bigBlindChips", 2)
    out.setdefault("buyInChips", 200)
    out.setdefault("actingSeatNumber", hero_seat_num)
    out.setdefault("actionDeadlineAt", int(time.time() * 1000) + 10_000)
    out.setdefault("recentEvents", [])

    seats_out = []
    for i, s in enumerate(seats_in):
        seats_out.append({
            "seatId": s.get("seatId", f"local_{i + 1}"),
            "seatNumber": s.get("seatNumber"),
            "agentId": s.get("agentId", f"local_seat_{i + 1}"),
            "agentName": s.get("agentName", s.get("agentHandle", "?")),
            "agentHandle": s.get("agentHandle", "?"),
            "status": s.get("status", "Active"),
            "stackChips": int(s.get("stackChips", 0)),
            "currentBetChips": int(s.get("currentBetChips", 0)),
            "totalCommittedChips": int(s.get("totalCommittedChips", 0)),
            "payoutChips": s.get("payoutChips"),
            "holeCards": s.get("holeCards"),
        })
    out["seats"] = seats_out

    a = table.get("allowedActions")
    if a is not None:
        avail = a.get("availableActions", []) or []
        bet_rng = a.get("betRange") or None
        raise_rng = a.get("raiseRange") or None
        hero_stack = next(
            (s["stackChips"] + s["currentBetChips"]
             for s in seats_out if s["seatNumber"] == hero_seat_num), 0
        )
        out["allowedActions"] = {
            "canFold": "fold" in avail,
            "canCheck": bool(a.get("canCheck", "check" in avail)),
            "canCall": "call" in avail,
            "canBet": bool(a.get("canBet", "bet" in avail)),
            "canRaise": bool(a.get("canRaise", "raise" in avail)),
            "canAllIn": "all-in" in avail,
            "callAmount": int(a.get("callChips", 0)),
            "callChips": int(a.get("callChips", 0)),
            "callToAmount": int(a.get("callToAmount", 0)) if a.get("callToAmount") else None,
            "minBet": (bet_rng or {}).get("min") if bet_rng else None,
            "minRaiseTo": (raise_rng or {}).get("min") if raise_rng else None,
            "maxCommit": hero_stack,
            "allInToAmount": hero_stack,
            "betRange": bet_rng,
            "raiseRange": raise_rng,
            "availableActions": avail,
            "amountSemantics": "toAmount",
            "amountHint": "selfplay synthetic",
            "actionHint": "selfplay synthetic",
        }

    # Synthesize blinds so derive_positions() works. We assume hero = BTN.
    if not out["recentEvents"] and seats_out and hero_seat_num:
        order = sorted(s["seatNumber"] for s in seats_out if s["seatNumber"] is not None)
        n = len(order)
        try:
            hero_idx = order.index(hero_seat_num)
        except ValueError:
            hero_idx = 0
        sb_seat = order[(hero_idx + 1) % n] if n >= 2 else hero_seat_num
        bb_seat = order[(hero_idx + 2) % n] if n >= 3 else order[(hero_idx + 1) % n]
        now_ms = int(time.time() * 1000)
        out["recentEvents"] = [
            {
                "id": "sb", "sequence": 1, "type": "BlindPosted", "street": "Preflop",
                "occurredAt": now_ms - 8000,
                "summary": {"action": "post", "amount": out["smallBlindChips"],
                            "seatNumber": sb_seat, "agentName": ""},
            },
            {
                "id": "bb", "sequence": 2, "type": "BlindPosted", "street": "Preflop",
                "occurredAt": now_ms - 7900,
                "summary": {"action": "post", "amount": out["bigBlindChips"],
                            "seatNumber": bb_seat, "agentName": ""},
            },
        ]
    return out


def decide(table: dict, *_: Any, **__: Any) -> dict:
    enriched = _enrich(table)
    try:
        t = Table.model_validate(enriched)
    except Exception as e:
        return {
            "action": "fold", "message": "gg",
            "reasoning": f"{{vr: typ:err, pp: parse {type(e).__name__}}}"[:150],
        }

    try:
        d = _loop.run_until_complete(_decide_async(t, _ctx))
    except Exception:
        d = safe_default(t.allowed_actions)

    from agent.reasoning import sanitize as _sanitize  # local import keeps top tidy
    out: dict[str, Any] = {
        "action": d.action,
        "message": d.message,
        "reasoning": _sanitize(d.reasoning),
    }
    if d.amount is not None:
        out["amount"] = d.amount
    return out
