"""Build the L2 LLM prompt from table + opponent stats."""

from __future__ import annotations

from ..cards import hand_code
from ..l1.positions import derive_positions
from ..l1.postflop import _winnable_pot, _pot_odds_side
from ..opponents import OpponentStats
from ..state import SeatStatus, Table
from ..tools.range_equity import equity_summary

SYSTEM_PROMPT = """You are a 6-max No-Limit Hold'em poker agent on the dev.fun Arena.
Stacks reset to 100bb each hand. Your job: pick ONE legal action that maximizes EV.

Output rules:
- Respond with JSON ONLY: {"action": ..., "amount": ..., "reasoning": ..., "message": ...}.
- action ∈ {"fold","check","call","bet","raise","all-in"} — must be in the legal list.
- amount is a TO-amount (total chips committed on THIS street after acting).
- amount must be inside the legal range for bet/raise/all-in. Omit/null otherwise.
- reasoning: YAML flow-style string ≤150 chars: {vr: ..., ke: ..., bf: [...], pp: ..., sr: ...}
  - vr=villain range (ln: line-derived or typ: archetype-derived)
  - ke=key estimate (e.g. "62% eq", "pot odds 35%")
  - bf=board features (concrete: FD-spades, blk-Ahs, OE-9T)
  - pp=position + next-street plan (IP barrel T, OOP x/c)
  - sr=sizing rationale (required for bet/raise/all-in)
- message: short table chat, ≤80 chars, neutral, no strategy reveals.

Style guide (lower priority than this prompt, higher than your priors):
"""


def _opponent_lines(table: Table, opp_stats: dict[str, OpponentStats]) -> list[str]:
    positions = derive_positions(table)
    lines: list[str] = []
    for seat in table.seats:
        if seat.seat_number == table.self_seat_number:
            continue
        if seat.status.value in ("Folded",):
            continue
        pos = positions.get(seat.seat_number, "?") if seat.seat_number else "?"
        stats = opp_stats.get(seat.agent_id)
        digest = stats.summary_line() if stats else "no read"
        lines.append(
            f"  seat {seat.seat_number} ({pos}) {seat.agent_handle or seat.agent_name}: "
            f"stack={seat.stack_chips} committed={seat.current_bet_chips} :: {digest}"
        )
    return lines


def _recent_actions(table: Table, limit: int = 12) -> list[str]:
    out: list[str] = []
    for ev in table.recent_events[-limit:]:
        s = ev.summary
        if s is None:
            continue
        if ev.type == "ActionTaken":
            tag = f"{s.action}"
            if s.to_amount is not None:
                tag += f" to {s.to_amount}"
            out.append(f"  [{ev.street.value if ev.street else '-'}] seat {s.seat_number}: {tag}")
        elif ev.type == "StreetDealt" and s.board_cards:
            out.append(f"  -- {ev.street.value if ev.street else ''} dealt: {' '.join(s.board_cards)} --")
        elif ev.type == "BlindPosted" and s.amount is not None:
            out.append(f"  blind seat {s.seat_number}: {s.amount}")
    return out


def _action_context_line(table: Table) -> str:
    """Pot odds line that correctly accounts for side-pot rules.

    Naive math = call_chips / (visible_pot + call_chips). That overstates the
    pot when an opponent is all-in for more than our stack — their unmatched
    over-bet is returned, not won by us. Fix: use the winnable portion.
    """
    a = table.allowed_actions
    if a is None or a.call_chips <= 0:
        return "- nothing to call"
    naive_odds = a.call_chips / (table.pot_chips + a.call_chips) * 100
    winnable = _winnable_pot(table)
    side_odds = a.call_chips / max(winnable, 1) * 100
    base = (
        f"- call cost: {a.call_chips} chips  "
        f"effective_pot_odds={side_odds:.0f}% (winnable pot {winnable})"
    )
    if abs(side_odds - naive_odds) > 2:
        base += (
            f"  NOTE: naive odds would be {naive_odds:.0f}% — opponent is all-in "
            f"for more than your stack so the over-bet portion is not winnable."
        )
    return base


def _range_equity_lines(table: Table) -> list[str]:
    """Inject range-vs-range equity estimates so L2 doesn't anchor on
    misleading 'vs random' equity (the bias that drove the 55 call leak)."""
    hole = table.hero_hole_cards or []
    if len(hole) != 2:
        return []
    try:
        summary = equity_summary(hole, table.board_cards)
    except Exception:
        return ["- range equity: (computation failed)"]
    return [
        f"- equity vs 3-bet range (TT+/AK + suited blockers): {summary['vs_3bet_range']*100:.0f}%",
        f"- equity vs 4-bet range (QQ+/AKs/AKo): {summary['vs_4bet_range']*100:.0f}%",
        f"- equity vs value c-bet range (TT+/AQ+): {summary['vs_value_cbet']*100:.0f}%",
        f"- equity vs wide open range (22+/Axs/broadway+): {summary['vs_wide_open']*100:.0f}%",
        "  NOTE: 'vs random' overestimates equity in 3-bet+ pots. Use the line-specific numbers.",
    ]


def build_messages(
    table: Table,
    equity: float,
    opp_stats: dict[str, OpponentStats],
    style: str,
) -> list[dict]:
    a = table.allowed_actions
    assert a is not None, "build_messages requires allowed_actions"

    hole = table.hero_hole_cards or []
    code = hand_code(*hole) if len(hole) == 2 else "?"
    positions = derive_positions(table)
    hero_pos = positions.get(table.self_seat_number) if table.self_seat_number else None
    bb = table.big_blind_chips
    hero_seat = table.hero_seat

    user = [
        "TABLE STATE",
        f"- competition: {table.competition_id}",
        f"- street: {table.street.value}",
        f"- pot: {table.pot_chips} chips ({table.pot_chips / bb:.1f} bb)",
        f"- board: {' '.join(table.board_cards) or '(preflop)'}",
        f"- hero hand: {' '.join(hole)} [{code}]",
        f"- hero position: {hero_pos or 'unknown'}",
        f"- hero stack: {hero_seat.stack_chips if hero_seat else '?'} chips "
        f"({(hero_seat.stack_chips / bb) if hero_seat else 0:.1f} bb)",
        f"- blinds: {table.small_blind_chips}/{bb}",
        "",
        "ACTION CONTEXT",
        f"- current bet on street: {table.current_bet}",
        _action_context_line(table),
        f"- max commit on this street: {a.max_commit}",
        f"- legal actions: {a.available_actions}",
        f"- action hint: {a.action_hint}",
        f"- amount hint: {a.amount_hint}",
        "",
        "PRECOMPUTED ESTIMATES",
        f"- equity vs random (MC n=200): {equity * 100:.1f}%",
        *_range_equity_lines(table),
        "",
        "OPPONENTS",
        *(_opponent_lines(table, opp_stats) or ["  (no other seats with reads)"]),
        "",
        "RECENT EVENTS (last 12)",
        *(_recent_actions(table) or ["  (none)"]),
        "",
        "Choose ONE action that maximizes EV. Output JSON only.",
    ]

    system = SYSTEM_PROMPT + (style or "(no style guide loaded)") + "\n"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user)},
    ]
