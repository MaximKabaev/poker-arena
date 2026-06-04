"""6-max 100bb TAG-baseline preflop ranges.

These are approximate consensus ranges, not solver-true. Used as L1 baseline
until precomputed solver charts land. Sources: composite of RangeConverter
free PDF, PokerCoaching free GTO charts, common TAG charts.
"""

from __future__ import annotations

from ..cards import expand_range

# Raise-first-in (RFI) ranges — protect-the-lead mode (2026-06-04 round 3).
# After a +1003 spike to 1911 chips / rank 70, tightening BTN/CO/SB back to
# rock-baseline levels. Goal: minimise variance, preserve stack. We still
# value-bet/raise strong hands aggressively (river fix kept) — we just enter
# fewer hands voluntarily.
RFI: dict[str, frozenset[str]] = {
    "UTG": expand_range(
        "88+, AJs+, KQs, AQo+"
    ),
    "HJ": expand_range(
        "77+, ATs+, KJs+, QJs, AJo+, KQo"
    ),
    "CO": expand_range(
        "22+, A8s+, KTs+, QTs+, JTs, T9s, ATo+, KJo+, QJo"
    ),
    "BTN": expand_range(
        "22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, 87s, "
        "ATo+, KJo+, QJo, JTo"
    ),
    "SB": expand_range(
        "22+, A8s+, KTs+, QTs+, JTs, ATo+, KJo+, QJo"
    ),
}

# Facing a single open: ranges to 3-bet (value), call, or fold.
# Tier the opener: "early" = UTG/HJ, "late" = CO/BTN, "blind" = SB.
THREE_BET_VS_EARLY: frozenset[str] = expand_range("QQ+, AKs, AKo")
THREE_BET_VS_LATE: frozenset[str] = expand_range("TT+, AQs+, AKo, KQs")
THREE_BET_VS_BLIND: frozenset[str] = expand_range("99+, AJs+, AQo+, KQs")

# Call-an-open ranges (non-BB). Tightened 2026-06-04 to match rock baseline.
# We rarely call wide — most of our "facing open" play is 3-bet or fold.
CALL_VS_EARLY: frozenset[str] = expand_range(
    "55-TT, AJs, AQs, KQs, KJs, QJs, JTs"
)
CALL_VS_LATE: frozenset[str] = expand_range(
    "22-TT, ATs+, KTs+, QTs+, JTs, T9s, 98s, KQo, AJo+"
)
CALL_VS_BLIND: frozenset[str] = expand_range(
    "22-99, ATs+, KTs+, QTs+, JTs, T9s, AJo+, KQo"
)

# BB defense ranges vs single open. BB has 0.5bb invested → still wider than other
# positions, but tightened from before to drop the trash-hand defense leak.
BB_CALL_VS_EARLY: frozenset[str] = expand_range(
    "22-TT, A2s+, KTs+, QTs+, JTs, T9s, 98s, 87s, ATo+, KJo+, QJo"
)
BB_CALL_VS_LATE: frozenset[str] = expand_range(
    "22-TT, A2s+, K8s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, "
    "A7o+, K9o+, Q9o+, J9o+, T9o"
)
BB_CALL_VS_BLIND: frozenset[str] = expand_range(
    "22-99, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, "
    "A2o+, K8o+, Q9o+, J9o+, T9o"
)

# Facing a 3-bet: 4-bet (value-only at L1) or call with playable hands.
FOUR_BET_VALUE: frozenset[str] = expand_range("KK+, AKs")
# Hands worth calling a 3-bet at 100bb+ depth — fold-to-3bet leak fix.
# AKo, AQs, big pairs: too strong to fold, not in 4-bet value.
CALL_VS_3BET: frozenset[str] = expand_range("88, 99, TT, JJ, QQ, AKo, AQs, AJs")

# Hands that are playable cheaply but NOT in our RFI range. Used to limp-in
# (just call the blind) when nobody raised and we can see a flop for 1-2 chips —
# typically completing the SB or limping behind from BTN/CO in a folded-around pot.
# Implied-odds hands: suited connectors, suited aces, broadway-light, small pairs.
LIMP_PLAYABLE: frozenset[str] = expand_range(
    "22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 98s, 87s, 76s, 65s, 54s, "
    "ATo+, KJo+, QJo, JTo, T9o"
)


def opener_tier(position: str) -> str:
    return {"UTG": "early", "HJ": "early", "CO": "late", "BTN": "late", "SB": "blind"}.get(
        position, "late"
    )


def three_bet_set(opener_pos: str) -> frozenset[str]:
    return {
        "early": THREE_BET_VS_EARLY,
        "late": THREE_BET_VS_LATE,
        "blind": THREE_BET_VS_BLIND,
    }[opener_tier(opener_pos)]


def call_open_set(hero_pos: str, opener_pos: str) -> frozenset[str]:
    if hero_pos == "BB":
        return {
            "early": BB_CALL_VS_EARLY,
            "late": BB_CALL_VS_LATE,
            "blind": BB_CALL_VS_BLIND,
        }[opener_tier(opener_pos)]
    return {
        "early": CALL_VS_EARLY,
        "late": CALL_VS_LATE,
        "blind": CALL_VS_BLIND,
    }[opener_tier(opener_pos)]
