"""Spot classification — map (table state, action) into structured spot tags.

Same vocabulary is used both when recording opponent actions and when
checking patterns at our own decision time. That symmetry is the key
to "play in spot X the same way regardless of who's there."
"""

from __future__ import annotations

from enum import Enum

from ..state import Street, Table


class SpotType(str, Enum):
    # Preflop
    RFI = "rfi"                          # first voluntary chips in
    FACING_OPEN = "facing_open"          # facing a single raise
    FACING_3BET = "facing_3bet"          # facing two raises
    FACING_4BET = "facing_4bet"          # facing three raises
    # Postflop, PFR's decision when first-to-act / checked-to
    PFR_CBET_FLOP = "pfr_cbet_flop"
    # Postflop, non-PFR caller facing a c-bet from PFR
    CALLER_FACING_CBET = "caller_facing_cbet"
    # Postflop, non-PFR caller after PFR checked (steal opportunity)
    CALLER_FACING_CHECK = "caller_facing_check"
    # Generic
    RIVER_BET = "river_bet"
    UNKNOWN = "unknown"


def _count_preflop_raises(table: Table, up_to_seq: int | None = None) -> int:
    n = 0
    for ev in table.recent_events:
        if up_to_seq is not None and ev.sequence >= up_to_seq:
            break
        if (
            ev.type == "ActionTaken"
            and ev.summary
            and ev.summary.action == "raise"
            and ev.street == Street.PREFLOP
        ):
            n += 1
    return n


def preflop_aggressor_seat(table: Table, up_to_seq: int | None = None) -> int | None:
    """The last seat to raise preflop — the PFR — up to a given sequence."""
    out: int | None = None
    for ev in table.recent_events:
        if up_to_seq is not None and ev.sequence >= up_to_seq:
            break
        if (
            ev.type == "ActionTaken"
            and ev.summary
            and ev.summary.action == "raise"
            and ev.street == Street.PREFLOP
            and ev.summary.seat_number is not None
        ):
            out = ev.summary.seat_number
    return out


def _street_has_bet_before(
    table: Table, street: Street, up_to_seq: int
) -> bool:
    """True if anyone has bet/raised on `street` before `up_to_seq`."""
    for ev in table.recent_events:
        if ev.sequence >= up_to_seq:
            break
        if (
            ev.type == "ActionTaken"
            and ev.summary
            and ev.street == street
            and ev.summary.action in ("bet", "raise")
        ):
            return True
    return False


def current_spot(table: Table) -> SpotType:
    """Classify the CURRENT decision point the acting seat faces."""
    street = table.street
    if street == Street.PREFLOP:
        raises = _count_preflop_raises(table)
        return [SpotType.RFI, SpotType.FACING_OPEN, SpotType.FACING_3BET, SpotType.FACING_4BET][
            min(raises, 3)
        ]
    if street == Street.FLOP:
        pfr = preflop_aggressor_seat(table)
        acting = table.acting_seat_number
        if pfr is None or acting is None:
            return SpotType.UNKNOWN
        # Anyone bet on the flop yet? Use a high seq to look at all events.
        flop_has_bet = any(
            ev.type == "ActionTaken" and ev.summary
            and ev.street == Street.FLOP
            and ev.summary.action in ("bet", "raise")
            for ev in table.recent_events
        )
        if acting == pfr:
            # PFR's turn — about to either c-bet or check
            return SpotType.PFR_CBET_FLOP
        # Non-PFR acting
        if flop_has_bet:
            return SpotType.CALLER_FACING_CBET
        return SpotType.CALLER_FACING_CHECK
    if street == Street.RIVER:
        return SpotType.RIVER_BET
    return SpotType.UNKNOWN


def classify_action(
    table: Table, actor_seat: int, action: str, street: Street, sequence: int
) -> tuple[SpotType, str]:
    """Classify an OBSERVED action by `actor_seat` into (spot, outcome).

    `outcome` is a normalised label for what they did in that spot.
    """
    if street == Street.PREFLOP:
        raises_before = _count_preflop_raises(table, up_to_seq=sequence)
        spot = [SpotType.RFI, SpotType.FACING_OPEN, SpotType.FACING_3BET, SpotType.FACING_4BET][
            min(raises_before, 3)
        ]
        return spot, action.lower()

    if street == Street.FLOP:
        pfr = preflop_aggressor_seat(table, up_to_seq=sequence)
        flop_bet = _street_has_bet_before(table, Street.FLOP, sequence)
        if pfr == actor_seat:
            if flop_bet:
                # PFR is facing a check-raise — covered by separate spot later.
                return SpotType.UNKNOWN, action.lower()
            return SpotType.PFR_CBET_FLOP, action.lower()
        # Non-PFR
        if flop_bet:
            return SpotType.CALLER_FACING_CBET, action.lower()
        return SpotType.CALLER_FACING_CHECK, action.lower()

    return SpotType.UNKNOWN, action.lower()
