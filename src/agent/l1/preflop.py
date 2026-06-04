"""Preflop L1 decision.

Returns a Decision if the spot is clearly chart-handleable. Returns None
for ambiguous spots (multiway raises, 4-bet pots, limp scenarios with
non-standard sizing) so the caller can escalate.
"""

from __future__ import annotations

from ..cards import expand_range, hand_code
from ..context import DecisionContext
from ..patterns.spots import SpotType
from ..reasoning import build as build_reasoning
from ..state import ActionType, AllowedActions, Decision, Table
from . import ranges as R
from .exploits import is_outlier, seat_to_agent_id
from .positions import derive_positions, hero_position, opener_seat_preflop

# Hands we 3-bet as bluffs when opener has the fold-to-3bet pattern.
# Suited wheel aces + suited connectors — good blockers + post-flop playability
# if the bluff gets called.
BLUFF_3BET_EXPLOIT = expand_range("A2s, A3s, A4s, A5s, T9s, 98s, 87s, 76s, 65s")


def _count_raises(table: Table) -> int:
    return sum(
        1 for ev in table.recent_events
        if ev.type == "ActionTaken" and ev.summary and ev.summary.action == "raise"
    )


def _open_size_to(table: Table, hero_pos: str) -> int:
    """Return TO-amount for a standard open by hero position."""
    bb = table.big_blind_chips
    base = {"UTG": 2.3, "HJ": 2.5, "CO": 2.5, "BTN": 2.5, "SB": 3.0}.get(hero_pos, 2.5)
    return max(int(round(base * bb)), table.big_blind_chips)


def _three_bet_size_to(table: Table, ip: bool) -> int:
    """3-bet sizing: 3x opener IP, 4x OOP, capped by maxCommit."""
    a = table.allowed_actions
    open_to = table.current_bet
    factor = 3.0 if ip else 4.0
    target = int(round(open_to * factor))
    if a and a.min_raise_to:
        target = max(target, a.min_raise_to)
    return target


def _cap_to_allowed(amount: int, allowed: AllowedActions) -> int:
    return max(allowed.min_raise_to or amount, min(amount, allowed.max_commit))


def _value_action(
    target_amount: int, a: AllowedActions
) -> tuple[ActionType, int | None]:
    """Return the best legal value action for a wanted raise target.

    Prefers raise → all-in → call → fold. Handles the case where villain has
    already shoved (raise not legal) — instead of returning an illegal "raise",
    we either all-in (if room) or just call (still get value with the hand).
    """
    if a.can_raise and a.min_raise_to is not None:
        amount = max(a.min_raise_to, min(target_amount, a.max_commit))
        return "raise", amount
    if a.can_all_in and a.all_in_to_amount is not None:
        return "all-in", a.all_in_to_amount
    if a.can_call:
        return "call", None
    return "fold", None


def _reasoning(parts: dict[str, str]) -> str:
    return build_reasoning(parts)


def preflop_decide(table: Table, ctx: DecisionContext | None = None) -> Decision | None:
    a = table.allowed_actions
    if a is None or not table.hero_hole_cards or len(table.hero_hole_cards) != 2:
        return None

    code = hand_code(*table.hero_hole_cards)
    positions = derive_positions(table)
    hero_pos = positions.get(table.self_seat_number) if table.self_seat_number else None
    if hero_pos is None:
        return None

    raises = _count_raises(table)
    opener_seat = opener_seat_preflop(table)
    opener_pos = positions.get(opener_seat) if opener_seat is not None else None

    # Escalate to L2 when the opponent we're reacting to is an outlier
    # (maniac / nit / station). Static charts leak EV in those spots.
    if raises >= 1 and ctx and ctx.cache:
        opener_agent_id = seat_to_agent_id(table, opener_seat)
        if opener_agent_id:
            opener_stats = ctx.cache.get(opener_agent_id, table.competition_id)
            if is_outlier(opener_stats):
                return None  # escalate to L2

    # ---- unraised pot (RFI or BB-check-back) ----
    if raises == 0:
        # BB unraised → always check (free flop, never fold here).
        if hero_pos == "BB" and a.can_check:
            return Decision(
                action="check", message="gg", layer="L1",
                reasoning=_reasoning({"vr": "typ:limp field", "pp": "BB x", "ke": f"hand {code}"}),
            )
        # SB unraised — REVERTED: always-completing junk is OOP -EV.
        # Now: SB plays its RFI range for raise, LIMP_PLAYABLE for cheap call,
        # else fold. Standard SB strategy in solvable spots.
        if hero_pos not in R.RFI:
            return None
        if code in R.RFI[hero_pos]:
            to = _cap_to_allowed(_open_size_to(table, hero_pos), a)
            return Decision(
                action="raise" if a.can_raise else "bet",
                amount=to,
                message="gg",
                layer="L1",
                reasoning=_reasoning({
                    "vr": "typ:6max field",
                    "ke": f"RFI {hero_pos}",
                    "pp": f"{hero_pos} open",
                    "sr": f"open {to // table.big_blind_chips}bb",
                }),
            )
        # Cheap limp — see a flop for 1-2 chips with implied-odds hands.
        # Gated to LP/blinds only — UTG/HJ limps are statistically bad (invite
        # iso-raises and put us OOP for the entire hand).
        if (
            a.can_call
            and a.call_chips is not None
            and 0 < a.call_chips <= 2
            and code in R.LIMP_PLAYABLE
            and hero_pos in ("CO", "BTN", "SB")
        ):
            return Decision(
                action="call", message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "typ:unraised",
                    "ke": f"limp {code}",
                    "pp": f"{hero_pos} complete",
                    "sr": f"cheap {a.call_chips}c",
                }),
            )
        if a.can_check:
            return Decision(
                action="check", message="gg", layer="L1",
                reasoning=_reasoning({"vr": "typ:6max", "pp": "fold range x", "ke": f"hand {code}"}),
            )
        return Decision(
            action="fold", message="gg", layer="L1",
            reasoning=_reasoning({"vr": "typ:6max", "pp": "off-chart fold", "ke": f"hand {code}"}),
        )

    # ---- single open facing us ----
    if raises == 1 and opener_pos is not None:
        # Pattern override: if this opener folds to 3-bets at high freq, expand
        # our 3-bet range to include bluff combos (suited aces, suited connectors).
        # Re-enabled — was the +EV exploit that contributed to the +1003 spike.
        opener_agent_id = seat_to_agent_id(table, opener_seat)
        if ctx and ctx.registry and opener_agent_id:
            pat = ctx.registry.lookup(
                table.competition_id, opener_agent_id, SpotType.FACING_3BET
            )
            if pat and pat.name == "fold_to_3bet" and code in BLUFF_3BET_EXPLOIT:
                ip = hero_pos in ("BTN", "CO") and opener_pos not in ("BTN", "CO")
                target = _three_bet_size_to(table, ip)
                action, amount = _value_action(target, a)
                return Decision(
                    action=action, amount=amount, message="gg", layer="L1",
                    reasoning=build_reasoning({
                        "vr": f"ln:{opener_pos} folds3b {int(pat.confidence*100)}%",
                        "ke": f"3bet bluff {code}",
                        "pp": f"{hero_pos} {action}",
                        "sr": "exploit fold-to-3bet",
                    }),
                )
        if code in R.three_bet_set(opener_pos):
            ip = hero_pos in ("BTN", "CO") and opener_pos not in ("BTN", "CO")
            target = _three_bet_size_to(table, ip)
            action, amount = _value_action(target, a)
            return Decision(
                action=action,
                amount=amount,
                message="gg",
                layer="L1",
                reasoning=_reasoning({
                    "vr": f"ln:{opener_pos} open",
                    "ke": f"3bet val {code}",
                    "pp": f"{hero_pos} {action}",
                    "sr": f"{'3x IP' if ip else '4x OOP'}" if action == "raise" else "shove val",
                }),
            )
        if code in R.call_open_set(hero_pos, opener_pos) and a.can_call:
            return Decision(
                action="call", message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": f"ln:{opener_pos} open",
                    "ke": f"call IP" if hero_pos in ("BTN", "CO") else "call OOP",
                    "pp": f"{hero_pos} call",
                }),
            )
        if a.can_check:
            return Decision(
                action="check", message="gg", layer="L1",
                reasoning=_reasoning({"vr": f"ln:{opener_pos} open", "pp": "BB x off-chart"}),
            )
        return Decision(
            action="fold", message="gg", layer="L1",
            reasoning=_reasoning({"vr": f"ln:{opener_pos} open", "pp": "fold off-chart", "ke": code}),
        )

    # ---- facing 3-bet: 4-bet value, call playable, else fold ----
    if raises == 2:
        if code in R.FOUR_BET_VALUE:
            target = int(table.current_bet * 2.3)
            action, amount = _value_action(target, a)
            return Decision(
                action=action, amount=amount, message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:3bet val", "ke": f"4bet {code}",
                    "pp": f"{hero_pos} {action}",
                    "sr": "2.3x val" if action == "raise" else "shove val",
                }),
            )
        # AKo / AQs / big pairs — too strong to fold, not in 4-bet value.
        # Call to see a flop / realise equity.
        if code in R.CALL_VS_3BET and a.can_call:
            return Decision(
                action="call", message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:3bet val", "ke": f"call {code}",
                    "pp": f"{hero_pos} call vs 3bet",
                    "sr": "realise eq",
                }),
            )
        if a.can_check:
            return Decision(action="check", message="gg", layer="L1",
                             reasoning=_reasoning({"vr": "ln:3bet", "pp": "x off-chart"}))
        return Decision(
            action="fold", message="gg", layer="L1",
            reasoning=_reasoning({"vr": "ln:3bet val", "pp": "fold to 3bet", "ke": code}),
        )

    # ---- 4-bet+ pots: minimal chart so we don't safe-default-fold a monster ----
    # If L2 fires & succeeds, this branch is bypassed (L1 returns None first when
    # ctx is provided AND we want L2 to handle exotic spots). But if L2 fails
    # (timeout, error), decide() re-calls l1_decide(table, ctx=None) and lands
    # here — guaranteeing a sane action with premium hands.
    if raises >= 3:
        # Escalate to L2 when ctx is available (L2 may exploit better).
        if ctx is not None:
            return None
        # ctx=None means we are the L2-failure fallback. Play the chart.
        if code in R.FIVE_BET_SHOVE and a.can_all_in:
            return Decision(
                action="all-in",
                amount=a.all_in_to_amount or a.max_commit,
                message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:4bet+ val", "ke": f"5bet shove {code}",
                    "pp": f"{hero_pos} jam", "sr": "AA only",
                }),
            )
        if code in R.CALL_VS_4BET_PLUS and a.can_call:
            return Decision(
                action="call", message="gg", layer="L1",
                reasoning=_reasoning({
                    "vr": "ln:4bet+ val", "ke": f"call {code}",
                    "pp": f"{hero_pos} flat",
                    "sr": "premium realise eq",
                }),
            )
        if a.can_check:
            return Decision(
                action="check", message="gg", layer="L1",
                reasoning=_reasoning({"vr": "ln:4bet+", "pp": "x off-chart"}),
            )
        return Decision(
            action="fold", message="gg", layer="L1",
            reasoning=_reasoning({"vr": "ln:4bet+", "pp": "fold non-premium", "ke": code}),
        )

    return None
