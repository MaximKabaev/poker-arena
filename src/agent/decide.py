"""Top-level decision router.

Eventually routes to L1 (heuristic) / L2 (LLM) / L3 (solver lookup).
Until those land, this returns a safe-default action so the agent can
join tables and survive end-to-end with auto-folds avoided.
"""

from __future__ import annotations

import logging
import time

from .context import DecisionContext
from .l1 import l1_decide
from .l2 import l2_decide
from .state import ActionType, AllowedActions, Decision, Table

log = logging.getLogger("agent.decide")


def _safe_reasoning(action: ActionType, allowed: AllowedActions) -> str:
    """Minimal valid YAML-flow reasoning for safe-default actions.

    Eval benchmark tables reject actions without `reasoning`. Spec:
    `{vr: "<range>", ke: "<num+unit>", bf: [<features>], pp: "<plan>", sr: "<size reason>"}`
    sr is required for bet/raise/all-in. Max 150 chars.
    """
    pot_odds_pct = (
        round(allowed.call_amount * 100 / max(allowed.call_amount + allowed.max_commit, 1))
        if allowed.can_call and allowed.call_amount > 0 else None
    )
    if action == "fold":
        return "{vr: typ:unknown, pp: fold to pressure}"
    if action == "check":
        return "{vr: typ:unknown, pp: OOP x/c}"
    if action == "call":
        ke = f"pot odds {pot_odds_pct}%" if pot_odds_pct is not None else "min call"
        return f"{{vr: typ:unknown, ke: {ke}, pp: x/c}}"
    # bet / raise / all-in — only hit if no passive option exists (server-side edge).
    return f"{{vr: typ:unknown, pp: {action} forced, sr: only legal action}}"


def safe_default(allowed: AllowedActions) -> Decision:
    """Cheapest legal action — used on timeout, errors, or unimplemented spots.

    Priority: check → fold → min-call. Never bets or raises voluntarily.
    """
    if allowed.can_check:
        action: ActionType = "check"
        amount = None
    elif allowed.can_fold:
        action, amount = "fold", None
    elif allowed.can_call:
        action, amount = "call", None
    else:
        first = allowed.available_actions[0]
        action = first
        amount = None
        if first in ("bet", "raise", "all-in"):
            amount = allowed.min_bet or allowed.min_raise_to or allowed.all_in_to_amount
    return Decision(
        action=action,
        amount=amount,
        message="gg",
        reasoning=_safe_reasoning(action, allowed),
        layer="safe",
    )


async def decide(table: Table, ctx: DecisionContext) -> Decision:
    """Return the agent's action for the given table state.

    Order: L1 (cheap heuristic) → L2 (LLM) on escalation → safe-default fallback.
    Safety belt: even when L1 escalates, we keep a "value-play fallback" so if
    L2 fails on a spot where the hand is strong, we don't safe-default-fold a
    monster. Implemented by re-running L1 with escalation suppressed.
    """
    start = time.perf_counter()
    if table.allowed_actions is None:
        raise ValueError("decide() called on table with no allowed_actions")

    try:
        l1 = l1_decide(table, ctx)
    except Exception as e:
        log.warning("L1 raised %s — escalating", e)
        l1 = None

    if l1 is not None:
        l1.latency_ms = (time.perf_counter() - start) * 1000.0
        return l1

    try:
        l2 = await l2_decide(table, ctx)
    except Exception as e:
        log.warning("L2 raised %s — falling back", e)
        l2 = None

    if l2 is not None:
        l2.latency_ms = (time.perf_counter() - start) * 1000.0
        return l2

    # L2 failed and L1 escalated. Re-run L1 with no ctx so it skips escalation
    # and produces a chart-based decision — much safer than safe-default fold.
    try:
        l1_fallback = l1_decide(table, ctx=None)
    except Exception:
        l1_fallback = None

    decision = l1_fallback if l1_fallback is not None else safe_default(table.allowed_actions)
    if l1_fallback is None:
        log.warning("safe-default kicked in (L1 escalated, L2 failed, L1-no-ctx returned None)")
    decision.latency_ms = (time.perf_counter() - start) * 1000.0
    return decision
