"""L1 entry point: routes preflop vs postflop, returns None on uncertain spots."""

from __future__ import annotations

from ..context import DecisionContext
from ..state import Decision, Street, Table
from .postflop import postflop_decide
from .preflop import preflop_decide


def l1_decide(table: Table, ctx: DecisionContext | None = None) -> Decision | None:
    if table.street == Street.PREFLOP:
        return preflop_decide(table, ctx)
    if table.street in (Street.FLOP, Street.TURN, Street.RIVER):
        return postflop_decide(table, ctx)
    return None
