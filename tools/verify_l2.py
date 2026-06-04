"""Local end-to-end verifier for the L2 LLM path.

Synthesizes a 4-bet-pot Table state (where L1 escalates and L2 must fire),
calls decide() with full DecisionContext, and prints what comes back.

Run from project root:
    uv run python tools/verify_l2.py

Requires OPENAI_API_KEY in .env (or environment).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent.config import Settings, load_style  # noqa: E402
from agent.context import DecisionContext  # noqa: E402
from agent.decide import decide  # noqa: E402
from agent.opponents import OpponentStatsCache  # noqa: E402
from agent.state import Table  # noqa: E402


def _scenario_4bet_pot() -> dict:
    """6-max, hero on BTN with AKo, faces a 3-bet from SB. Two raises already
    on the street → L1 hits the 4-bet branch (KK+/AKs only) and folds AKo.
    Wait — AKo is in some 4-bet ranges. Use a true L1 escalation: raises==3.

    Scenario chosen: 4-bet pot, hero in BB with QQ deciding vs a 5-bet shove.
    L1 escalates on 4-bet+ pots (raises >= 3) — exactly what L2 should handle.
    """
    now_ms = int(time.time() * 1000)
    deadline = now_ms + 30_000
    return {
        "tableId": "synthetic_4bet_qq",
        "tableNumber": 1,
        "competitionId": "synthetic",
        "status": "Active",
        "street": "Preflop",
        "potChips": 90,
        "currentBet": 60,
        "minRaiseTo": 100,
        "startedAt": now_ms - 5000,
        "actionDeadlineAt": deadline,
        "boardCards": [],
        "smallBlindChips": 1,
        "bigBlindChips": 2,
        "buyInChips": 200,
        "actingSeatNumber": 3,
        "selfSeatNumber": 3,
        "seats": [
            {
                "seatId": "s1", "seatNumber": 1, "agentId": "bot_btn",
                "agentName": "BTN bot", "agentHandle": "btn_bot", "status": "Active",
                "stackChips": 200, "currentBetChips": 0, "totalCommittedChips": 0,
                "payoutChips": None, "holeCards": None,
            },
            {
                "seatId": "s2", "seatNumber": 2, "agentId": "bot_sb",
                "agentName": "SB bot", "agentHandle": "sb_villain", "status": "Active",
                "stackChips": 140, "currentBetChips": 60, "totalCommittedChips": 60,
                "payoutChips": None, "holeCards": None,
            },
            {
                "seatId": "s3", "seatNumber": 3, "agentId": "hero",
                "agentName": "Hero", "agentHandle": "hero", "status": "Active",
                "stackChips": 178, "currentBetChips": 22, "totalCommittedChips": 22,
                "payoutChips": None, "holeCards": ["Qh", "Qd"],
            },
        ],
        "allowedActions": {
            "canFold": True, "canCheck": False, "canCall": True,
            "canBet": False, "canRaise": True, "canAllIn": True,
            "callAmount": 38, "callChips": 38, "callToAmount": 60,
            "minBet": None, "minRaiseTo": 100, "maxCommit": 200,
            "allInToAmount": 200,
            "betRange": None, "raiseRange": {"min": 100, "max": 200},
            "availableActions": ["fold", "call", "raise", "all-in"],
            "amountSemantics": "toAmount",
            "amountHint": "amount is TOTAL committed on this street after acting (min raise 100, max 200)",
            "actionHint": "fold, call 38, raise 100-200, or all-in 200",
        },
        "recentEvents": [
            {
                "id": "e1", "sequence": 1, "type": "BlindPosted", "street": "Preflop",
                "occurredAt": now_ms - 8000,
                "summary": {"action": "post", "amount": 1, "seatNumber": 2,
                            "agentName": "SB bot"},
            },
            {
                "id": "e2", "sequence": 2, "type": "BlindPosted", "street": "Preflop",
                "occurredAt": now_ms - 7900,
                "summary": {"action": "post", "amount": 2, "seatNumber": 3,
                            "agentName": "Hero"},
            },
            {
                "id": "e3", "sequence": 3, "type": "ActionTaken", "street": "Preflop",
                "occurredAt": now_ms - 6000,
                "summary": {"action": "raise", "amount": 6, "toAmount": 6,
                            "seatNumber": 1, "agentName": "BTN bot"},
            },
            {
                "id": "e4", "sequence": 4, "type": "ActionTaken", "street": "Preflop",
                "occurredAt": now_ms - 5000,
                "summary": {"action": "raise", "amount": 22, "toAmount": 22,
                            "seatNumber": 2, "agentName": "SB bot"},
            },
            {
                "id": "e5", "sequence": 5, "type": "ActionTaken", "street": "Preflop",
                "occurredAt": now_ms - 4000,
                "summary": {"action": "raise", "amount": 60, "toAmount": 60,
                            "seatNumber": 1, "agentName": "BTN bot"},
            },
        ],
    }


async def main() -> int:
    settings = Settings()
    if not settings.openai_api_key:
        print("ERROR: OPENAI_API_KEY not set in .env or environment")
        return 1

    style = load_style()
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
        db_path = Path(tmp.name)
    cache = OpponentStatsCache(db_path)
    ctx = DecisionContext(settings=settings, cache=cache, style=style)

    raw = _scenario_4bet_pot()
    table = Table.model_validate(raw)

    print("=" * 70)
    print(f"Scenario: 4-bet pot. Hero in BB with QQ vs BTN 4-bet to 60.")
    print(f"Street={table.street.value}  pot={table.pot_chips}  "
          f"call={table.allowed_actions.call_chips}  legal={table.allowed_actions.available_actions}")
    print(f"Hole={table.hero_hole_cards}  hero_seat={table.self_seat_number}")
    print(f"L2 model={settings.llm_model}  budget={settings.llm_budget_seconds}s")
    print("=" * 70)

    t0 = time.perf_counter()
    decision = await decide(table, ctx)
    dt = (time.perf_counter() - t0) * 1000

    print(f"\nDECISION  (took {dt:.0f}ms, layer={decision.layer})")
    print(f"  action     : {decision.action}")
    print(f"  amount     : {decision.amount}")
    print(f"  message    : {decision.message}")
    print(f"  reasoning  : {decision.reasoning}")
    print()

    cache.close()
    db_path.unlink(missing_ok=True)

    if decision.layer == "L2":
        print("✓ L2 path verified end-to-end.")
        return 0
    if decision.layer == "L1":
        print("⚠ L1 handled this spot — L2 not exercised. Pick a deeper scenario.")
        return 2
    print(f"✗ Fell through to {decision.layer} — investigate logs.")
    return 3


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
