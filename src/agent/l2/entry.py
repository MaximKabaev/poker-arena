"""L2 LLM decision: GPT-5.3 single-shot with precomputed equity + opponent stats."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from openai import AsyncOpenAI

from ..cards import hand_code
from ..context import DecisionContext
from ..opponents import OpponentStats
from ..reasoning import sanitize as sanitize_reasoning
from ..state import ActionType, Decision, Street, Table
from ..tools.equity import equity_vs_random
from .prompt import build_messages

log = logging.getLogger("agent.l2")

_LEGAL: set[str] = {"fold", "check", "call", "bet", "raise", "all-in"}


def _validate_amount(action: str, amount: int | None, table: Table) -> int | None:
    """Clamp/validate amount to legal range; raise on invalid action."""
    a = table.allowed_actions
    assert a is not None
    if action in ("fold", "check", "call"):
        return None
    if amount is None:
        raise ValueError(f"{action} requires amount")
    lo, hi = None, a.max_commit
    if action == "bet":
        if not a.can_bet or a.min_bet is None:
            raise ValueError("bet not legal")
        lo = a.min_bet
    elif action == "raise":
        if not a.can_raise or a.min_raise_to is None:
            raise ValueError("raise not legal")
        lo = a.min_raise_to
    elif action == "all-in":
        if not a.can_all_in or a.all_in_to_amount is None:
            raise ValueError("all-in not legal")
        lo = hi = a.all_in_to_amount
    if lo is None:
        return None
    return max(lo, min(hi, int(amount)))


async def _opponent_snapshot(
    ctx: DecisionContext, table: Table
) -> dict[str, OpponentStats]:
    """Read whatever's currently cached for this table's opponents. Never blocks on API."""
    if ctx.cache is None:
        return {}
    out: dict[str, OpponentStats] = {}
    for seat in table.seats:
        if seat.seat_number == table.self_seat_number or not seat.agent_id:
            continue
        hit = ctx.cache.get(seat.agent_id, table.competition_id)
        if hit is not None:
            out[seat.agent_id] = hit
    return out


async def _llm_call(
    client: AsyncOpenAI, model: str, messages: list[dict], budget_seconds: float
) -> dict | None:
    try:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
            ),
            timeout=budget_seconds,
        )
    except TimeoutError:
        log.warning("L2 LLM call timed out after %.1fs", budget_seconds)
        return None
    except Exception as e:
        log.warning("L2 LLM call failed: %s", e)
        return None

    content = resp.choices[0].message.content
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        log.warning("L2 response not valid JSON: %s :: %s", e, content[:200])
        return None


async def l2_decide(table: Table, ctx: DecisionContext) -> Decision | None:
    """Fire GPT-5.3 with a rich single-shot prompt. Returns None on any failure."""
    a = table.allowed_actions
    if a is None:
        return None
    if not ctx.settings.openai_api_key:
        log.debug("L2 skipped: no OPENAI_API_KEY set")
        return None
    hole = table.hero_hole_cards or []
    if len(hole) != 2:
        return None

    t0 = time.perf_counter()
    try:
        eq = equity_vs_random(hole, table.board_cards, n=200)
    except Exception as e:
        log.warning("equity failed: %s", e)
        eq = 0.5  # neutral fallback

    opp_stats = await _opponent_snapshot(ctx, table)
    messages = build_messages(table, eq, opp_stats, ctx.style)

    client = AsyncOpenAI(api_key=ctx.settings.openai_api_key)
    data = await _llm_call(
        client, ctx.settings.llm_model, messages, ctx.settings.llm_budget_seconds
    )
    if not isinstance(data, dict):
        return None

    action = str(data.get("action", "")).lower().strip()
    if action not in _LEGAL or action not in a.available_actions:
        log.warning("L2 returned illegal action %r — escalating", action)
        return None

    try:
        amount = _validate_amount(action, data.get("amount"), table)
    except (ValueError, TypeError) as e:
        log.warning("L2 amount invalid: %s", e)
        return None

    reasoning = sanitize_reasoning(str(data.get("reasoning") or ""))
    message = str(data.get("message") or "gg")[:500]
    latency = (time.perf_counter() - t0) * 1000.0

    return Decision(
        action=action,  # type: ignore[arg-type]
        amount=amount,
        message=message,
        reasoning=reasoning,
        layer="L2",
        latency_ms=latency,
    )
