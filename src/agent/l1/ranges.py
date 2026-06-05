"""6-max 100bb TAG-baseline preflop ranges.

These are approximate consensus ranges, not solver-true. Used as L1 baseline
until precomputed solver charts land. Sources: composite of RangeConverter
free PDF, PokerCoaching free GTO charts, common TAG charts.
"""

from __future__ import annotations

from ..cards import expand_range

# Raise-first-in (RFI) ranges — AGGRESSIVE MODE (2026-06-05).
# Wider at every position. ~22% avg VPIP. The +14.80 baseline was achieved with
# tighter ranges; loosening here is a directional bet that the Playground field
# folds enough preflop that wider opens pick up dead money.
RFI: dict[str, frozenset[str]] = {
    "UTG": expand_range(
        "66+, ATs+, KTs+, QJs, JTs, AJo+, KQo"
    ),
    "HJ": expand_range(
        "55+, A9s+, K9s+, QTs+, JTs, T9s, ATo+, KJo+, QJo"
    ),
    "CO": expand_range(
        "22+, A2s+, K8s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, "
        "A8o+, KTo+, QTo+, JTo"
    ),
    "BTN": expand_range(
        "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 53s+, "
        "A2o+, K8o+, Q9o+, J9o+, T9o, 98o, 87o, 76o"
    ),
    "SB": expand_range(
        "22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, "
        "A7o+, K9o+, Q9o+, J9o+, T9o"
    ),
}

# Facing a single open: ranges to 3-bet (value + light), call, or fold.
# Widened in aggressive mode — more value 3-bets AND bluff combos when patterns
# don't trigger (the fold_to_3bet exploit branch handles deeper bluffs).
THREE_BET_VS_EARLY: frozenset[str] = expand_range("JJ+, AQs+, AKo, KQs, A5s")
THREE_BET_VS_LATE: frozenset[str] = expand_range(
    "99+, AJs+, AQo+, KQs, KJs, A5s, A4s"
)
THREE_BET_VS_BLIND: frozenset[str] = expand_range(
    "88+, ATs+, AJo+, KQs, KJs, QJs, A5s, A4s"
)

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

# Facing a 3-bet: 4-bet (value + AKo) or call playable hands.
# Aggressive mode adds QQ + AKo to 4-bet for value.
FOUR_BET_VALUE: frozenset[str] = expand_range("QQ, KK, AA, AKs, AKo")
# Hands worth calling a 3-bet at 100bb+ depth — fold-to-3bet leak fix.
# AKo, AQs, big pairs: too strong to fold, not in 4-bet value.
CALL_VS_3BET: frozenset[str] = expand_range(
    "77, 88, 99, TT, JJ, QQ, AKo, AQs, AQo, AJs, KQs, KJs, QJs, JTs"
)

# Facing a 4-bet+ (cold 4-bet, 5-bet, or deeper). Used as L1 chart so we never
# safe-default-fold a monster when L2 times out.
# Aggressive mode: shove AA/KK, call with everything reasonably defensible.
FIVE_BET_SHOVE: frozenset[str] = expand_range("KK, AA, AKs")
CALL_VS_4BET_PLUS: frozenset[str] = expand_range(
    "JJ, QQ, KK, AKo, AKs, AQs"
)

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
