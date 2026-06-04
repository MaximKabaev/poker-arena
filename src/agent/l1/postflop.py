"""Postflop L1 decision: pot odds + made-hand strength via pokerkit.

Strategy:
- Classify hero's made hand (pokerkit StandardHighHand) into a tier.
- Facing a bet: pot-odds call with medium+, fold air; value-raise with strong+.
- No bet to face: value-bet small with strong+, check otherwise.
- No L1 bluffs — L2 handles bluffs.
"""

from __future__ import annotations

from typing import Literal

from pokerkit import StandardHighHand
from pokerkit.lookups import Label

from ..cards import RANK_VAL
from ..context import DecisionContext
from ..patterns.spots import SpotType, current_spot, preflop_aggressor_seat
from ..reasoning import build as build_reasoning
from ..state import AllowedActions, Decision, Street, Table
from .exploits import is_outlier, recent_aggressor_seat, seat_to_agent_id

HandTier = Literal["nuts", "strong", "medium", "marginal", "air"]
DrawType = Literal["combo", "FD", "OE", "GS", "none"]


_LABEL_TIER: dict[Label, HandTier] = {
    Label.STRAIGHT_FLUSH: "nuts",
    Label.FOUR_OF_A_KIND: "nuts",
    Label.FULL_HOUSE: "strong",
    Label.FLUSH: "strong",
    Label.STRAIGHT: "strong",
    Label.THREE_OF_A_KIND: "strong",
    Label.TWO_PAIR: "strong",
    Label.HIGH_CARD: "air",
}


def _classify(hole: list[str], board: list[str]) -> Label:
    return StandardHighHand.from_game("".join(hole), "".join(board)).entry.label


def _pair_subtier(hole: list[str], board: list[str]) -> HandTier:
    """Distinguish overpair / TPGK / underpair / weak-pair within ONE_PAIR."""
    board_ranks = [RANK_VAL[c[0].upper()] for c in board]
    hole_ranks = sorted([RANK_VAL[c[0].upper()] for c in hole], reverse=True)
    top_board = max(board_ranks)

    if hole_ranks[0] == hole_ranks[1]:
        return "strong" if hole_ranks[0] > top_board else "marginal"

    paired = next((r for r in hole_ranks if r in board_ranks), None)
    if paired is None:
        return "air"  # board pair, both hole cards unpaired with it
    kicker = next(r for r in hole_ranks if r != paired)
    if paired == top_board:
        return "medium" if kicker >= 11 else "marginal"  # TP, J+ kicker = TPGK
    return "marginal"  # middle / bottom pair


def _eval_tier(hole: list[str], board: list[str]) -> HandTier | None:
    if len(board) < 3:
        return None
    label = _classify(hole, board)
    if label == Label.ONE_PAIR:
        return _pair_subtier(hole, board)
    return _LABEL_TIER.get(label, "air")


def _river_tier_promotion(tier: HandTier, board_len: int) -> HandTier:
    """On the river, top pair good kicker is value — promote to strong.
    Earlier streets keep the conservative medium tier (still drawing).
    """
    if board_len >= 5 and tier == "medium":
        return "strong"
    return tier


def _tier_equity(tier: HandTier) -> float:
    return {"nuts": 0.95, "strong": 0.75, "medium": 0.55, "marginal": 0.30, "air": 0.10}[tier]


def _draw_type(hole: list[str], board: list[str]) -> DrawType:
    """Detect flush / open-ended / gutshot draws. Returns the strongest draw."""
    all_cards = hole + board
    suits = [c[1].lower() for c in all_cards]
    suit_counts: dict[str, int] = {}
    for s in suits:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    has_fd = max(suit_counts.values(), default=0) == 4

    ranks = {RANK_VAL[c[0].upper()] for c in all_cards}
    if 14 in ranks:
        ranks = ranks | {1}  # ace can play low for wheels

    has_oe = False
    has_gs = False
    # 4 consecutive — open-ended (one card each side completes a straight)
    for low in range(1, 12):
        if all(r in ranks for r in range(low, low + 4)):
            # We hold low..low+3 — extensions are low-1 (low end) or low+4 (high end)
            can_low = low - 1 >= 1
            can_high = low + 4 <= 14
            # Already a straight? (we hold an extension too)
            if can_low and (low - 1) in ranks:
                continue
            if can_high and (low + 4) in ranks:
                continue
            if can_low and can_high:
                has_oe = True
            elif can_low or can_high:
                has_gs = True
    # 4 of 5 in a window with inner gap — gutshot
    for low in range(1, 11):
        window = set(range(low, low + 5))
        present = window & ranks
        if len(present) == 4:
            missing = next(iter(window - present))
            if low < missing < low + 4:
                has_gs = True

    if has_fd and (has_oe or has_gs):
        return "combo"
    if has_fd:
        return "FD"
    if has_oe:
        return "OE"
    if has_gs:
        return "GS"
    return "none"


def _draw_equity(draw: DrawType) -> float:
    """Coarse drawing equity vs random — flop-to-river approximations."""
    return {"combo": 0.55, "FD": 0.36, "OE": 0.32, "GS": 0.16, "none": 0.0}[draw]


def _combined_equity(tier: HandTier, draw: DrawType) -> float:
    return max(_tier_equity(tier), _draw_equity(draw))


def _pot_odds(allowed: AllowedActions, pot: int) -> float:
    cost = allowed.call_chips
    return cost / (pot + cost) if cost > 0 else 0.0


def _reasoning(parts: dict[str, str]) -> str:
    return build_reasoning(parts)


def _pattern_override(
    table: Table, tier: HandTier, ctx: DecisionContext | None
) -> Decision | None:
    """Pattern-driven overrides for postflop. Returns None if no override applies."""
    from ..state import Street
    if ctx is None or ctx.registry is None or table.street != Street.FLOP:
        return None
    a = table.allowed_actions
    if a is None:
        return None
    spot = current_spot(table)

    # 1) caller_facing_check: PFR has checked to us → steal-bet if PFR has c_bet_whiff.
    # Reverted to fire with any non-air hand (back to pre-protect-the-lead state).
    if spot == SpotType.CALLER_FACING_CHECK and (a.can_bet or a.can_raise):
        pfr_seat = preflop_aggressor_seat(table)
        pfr_id = seat_to_agent_id(table, pfr_seat)
        if pfr_id:
            pat = ctx.registry.lookup(table.competition_id, pfr_id, SpotType.PFR_CBET_FLOP)
            if pat and pat.name == "c_bet_whiff" and tier != "air":
                target = max(int(table.pot_chips * 0.5), a.min_bet or 0)
                target = min(target, a.max_commit)
                return Decision(
                    action="bet" if a.can_bet else "raise",
                    amount=target, message="gg", layer="L1",
                    reasoning=_reasoning({
                        "vr": f"ln:PFR x {int(pat.confidence*100)}%",
                        "ke": f"tier {tier}",
                        "bf": f"flop {''.join(table.board_cards)[:6]}",
                        "pp": "IP steal",
                        "sr": "exploit c-bet whiff",
                    }),
                )

    # 2) PFR with marginal/air facing a caller who folds_to_cbet: bluff c-bet
    # Re-enabled — the +EV exploit vs flop-folders.
    if spot == SpotType.PFR_CBET_FLOP and tier in ("air", "marginal") and (a.can_bet or a.can_raise):
        for seat in table.active_opponents:
            pat = ctx.registry.lookup(
                table.competition_id, seat.agent_id, SpotType.CALLER_FACING_CBET
            )
            if pat and pat.name == "folds_to_cbet":
                target = max(int(table.pot_chips * 0.33), a.min_bet or 0)
                target = min(target, a.max_commit)
                return Decision(
                    action="bet" if a.can_bet else "raise",
                    amount=target, message="gg", layer="L1",
                    reasoning=_reasoning({
                        "vr": f"ln:{seat.agent_handle[:8]} folds-cb {int(pat.confidence*100)}%",
                        "ke": f"tier {tier}",
                        "bf": f"flop {''.join(table.board_cards)[:6]}",
                        "pp": "PFR bluff cb",
                        "sr": "33% pot exploit",
                    }),
                )
    return None


def postflop_decide(table: Table, ctx: DecisionContext | None = None) -> Decision | None:
    a = table.allowed_actions
    hole = table.hero_hole_cards
    if a is None or not hole or len(hole) != 2:
        return None

    board = table.board_cards
    try:
        tier = _eval_tier(hole, board)
    except Exception:
        return None
    if tier is None:
        return None

    # Detect draws — used both for pot-odds (combined equity) and for semibluffs.
    try:
        draw = _draw_type(hole, board)
    except Exception:
        draw = "none"

    # Escalate to L2 when the most recent aggressor is an outlier — but ONLY for
    # ambiguous tiers. With strong/nuts we ALWAYS value-bet/raise; escalation here
    # would risk L2 timeout → safe-default fold of a monster.
    #
    # Equity gate on turn/river: factor in villain's bluff frequency. Raw equity
    # vs random underestimates our equity vs a maniac (lots of bluffs in their
    # range we beat). Threshold: effective equity must be ≥30% on turn/river to
    # escalate. vs a nit (bluff% ~5), ace-high stays below threshold → L1 folds.
    # vs a maniac (bluff% ~40), ace-high gets +20% bluff boost → escalates so L2
    # can craft the exploit call.
    is_late_street = table.street in (Street.TURN, Street.RIVER)
    if ctx and ctx.cache and tier in ("medium", "marginal", "air"):
        aggressor_seat = recent_aggressor_seat(table)
        agg_id = seat_to_agent_id(table, aggressor_seat)
        if agg_id:
            stats = ctx.cache.get(agg_id, table.competition_id)
            if is_outlier(stats):
                # Bluff-aware effective equity: each 1% villain bluff freq adds
                # ~0.5% effective equity (we beat their bluffs at showdown).
                bluff_boost = 0.0
                if stats and stats.bluff_pct is not None:
                    bluff_boost = stats.bluff_pct * 0.5
                effective_eq = eq + bluff_boost
                if is_late_street and effective_eq < 0.30:
                    pass  # eq too low even with bluff boost — let L1 fold
                else:
                    return None  # escalate to L2

    # Pattern overrides on flop — c_bet_whiff and folds_to_cbet
    pat_decision = _pattern_override(table, tier, ctx)
    if pat_decision is not None:
        return pat_decision

    # On river, promote TPGK → strong so we value-raise/bet instead of just calling.
    is_river = len(board) >= 5
    if is_river:
        tier = _river_tier_promotion(tier, len(board))

    eq = _combined_equity(tier, draw)
    pot = table.pot_chips
    bf = f"board {''.join(board)[:10]}" if board else ""

    # ---- facing a bet/raise ----
    if a.can_call and a.call_chips > 0:
        odds = _pot_odds(a, pot)
        if tier in ("nuts", "strong") and a.can_raise:
            # On river, raise bigger for value (3x vs 2.5x) — extract more.
            mult = 3.0 if is_river else 2.5
            target = max(
                a.min_raise_to or 0,
                int(table.current_bet * mult),
            )
            target = min(target, a.max_commit)
            return Decision(
                action="raise", amount=target, message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:bet line", "ke": f"eq~{int(eq*100)}%",
                    "bf": bf, "pp": "value raise",
                    "sr": f"{mult}x val{'river' if is_river else ''}",
                }),
            )
        if eq >= odds + 0.05:
            return Decision(
                action="call", message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:bet line",
                    "ke": f"odds {int(odds*100)}% eq~{int(eq*100)}%",
                    "bf": bf, "pp": "pot odds call",
                }),
            )
        return Decision(
            action="fold", message="gg", layer="L1",
            reasoning=_reasoning({
                "vr": "ln:bet line",
                "ke": f"odds {int(odds*100)}% eq~{int(eq*100)}%",
                "bf": bf, "pp": "fold short odds",
            }),
        )

    # ---- no bet to face ----
    if a.can_check:
        if tier in ("nuts", "strong") and (a.can_bet or a.can_raise):
            # Bigger sizing on river — TPGK+ wants thin value and we extract more.
            # Flop/turn 50% pot (current), river 66% pot (new).
            sizing = 0.66 if is_river else 0.5
            target = max(int(pot * sizing), a.min_bet or 0)
            target = min(target, a.max_commit)
            return Decision(
                action="bet" if a.can_bet else "raise", amount=target,
                message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:checked to", "ke": f"eq~{int(eq*100)}%",
                    "bf": bf, "pp": "value bet",
                    "sr": f"{int(sizing*100)}% pot val",
                }),
            )
        # Semibluff — re-enabled (flop only, OE/combo only). Pre-big-win baseline.
        if (
            draw in ("combo", "OE")
            and table.street == Street.FLOP
            and tier == "air"
            and (a.can_bet or a.can_raise)
        ):
            target = max(int(pot * 0.33), a.min_bet or 0)
            target = min(target, a.max_commit)
            return Decision(
                action="bet" if a.can_bet else "raise", amount=target,
                message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:checked to",
                    "ke": f"draw {draw} eq~{int(eq*100)}%",
                    "bf": bf, "pp": "semibluff",
                    "sr": "33% pot SB",
                }),
            )
        return Decision(
            action="check", message="gg", layer="L1",
            reasoning=_reasoning({
                "vr": "ln:checked to", "ke": f"tier {tier} draw {draw}",
                "bf": bf, "pp": "pot ctrl x",
            }),
        )

    return None
