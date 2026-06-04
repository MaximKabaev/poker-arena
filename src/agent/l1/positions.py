"""Derive hero position (UTG/HJ/CO/BTN/SB/BB) and identify the opener.

Strategy: scan recent events for BlindPosted to find SB and BB seats, then
walk seat order to label everyone. The opener is the first seat that
voluntarily put chips in (raise) on the current street.
"""

from __future__ import annotations

from ..state import Table

# Position label in seat-order distance from BTN (BTN=0, SB=1, BB=2, UTG=3, ...)
POS_BY_OFFSET_6MAX = ["BTN", "SB", "BB", "UTG", "HJ", "CO"]
POS_BY_OFFSET_5 = ["BTN", "SB", "BB", "UTG", "CO"]
POS_BY_OFFSET_4 = ["BTN", "SB", "BB", "UTG"]
POS_BY_OFFSET_3 = ["BTN", "SB", "BB"]
POS_BY_OFFSET_2 = ["BTN", "BB"]  # heads-up: SB = BTN


def _label_table(num_seats: int) -> list[str]:
    return {
        6: POS_BY_OFFSET_6MAX,
        5: POS_BY_OFFSET_5,
        4: POS_BY_OFFSET_4,
        3: POS_BY_OFFSET_3,
        2: POS_BY_OFFSET_2,
    }.get(num_seats, POS_BY_OFFSET_6MAX[:num_seats])


def _ordered_seats(table: Table) -> list[int]:
    nums = sorted({s.seat_number for s in table.seats if s.seat_number is not None})
    return nums


def _find_blinds(table: Table) -> tuple[int | None, int | None]:
    """Return (sb_seat, bb_seat) from recent events. Falls back to None."""
    sb_seat = bb_seat = None
    for ev in table.recent_events:
        if ev.type != "BlindPosted" or ev.summary is None:
            continue
        amt = ev.summary.amount
        seat = ev.summary.seat_number
        if amt is None or seat is None:
            continue
        if amt == table.small_blind_chips:
            sb_seat = seat
        elif amt == table.big_blind_chips:
            bb_seat = seat
    return sb_seat, bb_seat


def derive_positions(table: Table) -> dict[int, str]:
    """Map seat_number -> position label."""
    seats = _ordered_seats(table)
    n = len(seats)
    if n == 0:
        return {}
    sb_seat, bb_seat = _find_blinds(table)
    if sb_seat is None and bb_seat is None:
        return {}

    # find BTN: seat that comes before SB in seat order.
    if sb_seat is not None:
        sb_idx = seats.index(sb_seat)
        btn_idx = (sb_idx - 1) % n
    else:
        bb_idx = seats.index(bb_seat)  # type: ignore[arg-type]
        btn_idx = (bb_idx - 2) % n

    labels = _label_table(n)
    result: dict[int, str] = {}
    for off in range(n):
        seat_num = seats[(btn_idx + off) % n]
        if off < len(labels):
            result[seat_num] = labels[off]
    return result


def hero_position(table: Table) -> str | None:
    if table.self_seat_number is None:
        return None
    return derive_positions(table).get(table.self_seat_number)


def opener_seat_preflop(table: Table) -> int | None:
    """First seat to take a raise action on the current hand. None if no raise yet."""
    for ev in table.recent_events:
        if ev.type != "ActionTaken" or ev.summary is None:
            continue
        if ev.summary.action == "raise":
            return ev.summary.seat_number
    return None
