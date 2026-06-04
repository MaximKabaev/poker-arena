"""Precomputed equity-vs-typical-line ranges.

Each table gives our hand's expected win rate against a STYLIZED opponent
range that fits a betting line ("3-bet range", "4-bet range", "c-bet
range"). Used as an L2 prompt input so the LLM has solver-flavoured numbers
instead of misleading "vs random" Monte Carlo estimates.

Generated at import time via Monte Carlo (n=1000) against curated ranges.
Adds ~3-5 seconds to first import; result is cached in module globals.
"""

from __future__ import annotations

import random
from itertools import product

from pokerkit import StandardHighHand

from ..cards import RANKS, SUITS, expand_range, hand_code

# Typical opponent ranges per line. Tuned to match what mid-stakes 6-max bots
# actually play (slightly looser than pure GTO due to weaker field).
RANGE_3BET = expand_range(
    "99, TT, JJ, QQ, KK, AA, AQs, AKs, AKo, KQs, A5s, A4s"
)
RANGE_4BET = expand_range("QQ, KK, AA, AKs, AKo, A5s")
RANGE_VALUE_CBET = expand_range(
    "TT+, AQs+, AKo, AJs+, KQs"
)
RANGE_WIDE_OPEN = expand_range(
    "22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, "
    "A8o+, KJo+, QJo, JTo"
)

# Combo-weighted sampler: a (rank1, suit1, rank2, suit2) tuple sampled
# uniformly from the range's combos.
def _sample_combo(range_set: frozenset[str], dead_cards: set[str]) -> tuple[str, str] | None:
    """Pick a random 2-card combo from the range, excluding dead cards."""
    # Collect candidates
    candidates: list[tuple[str, str]] = []
    for code in range_set:
        if len(code) == 2:
            r = code[0]
            for s1, s2 in [("c","d"),("c","h"),("c","s"),("d","h"),("d","s"),("h","s")]:
                c1 = f"{r}{s1}"; c2 = f"{r}{s2}"
                if c1 not in dead_cards and c2 not in dead_cards:
                    candidates.append((c1, c2))
        else:
            hi, lo, sfx = code[0], code[1], code[2]
            if sfx == "s":
                for s in SUITS:
                    c1 = f"{hi}{s}"; c2 = f"{lo}{s}"
                    if c1 not in dead_cards and c2 not in dead_cards:
                        candidates.append((c1, c2))
            else:  # offsuit
                for s1 in SUITS:
                    for s2 in SUITS:
                        if s1 == s2: continue
                        c1 = f"{hi}{s1}"; c2 = f"{lo}{s2}"
                        if c1 not in dead_cards and c2 not in dead_cards:
                            candidates.append((c1, c2))
    if not candidates:
        return None
    return random.choice(candidates)


_FULL_DECK = tuple(f"{r}{s}" for r, s in product(RANKS, SUITS))


def equity_vs_range(
    hole: list[str], board: list[str], range_set: frozenset[str], n: int = 400,
    seed: int | None = 42,
) -> float:
    """Monte Carlo equity of hero's hand vs a random combo drawn from range_set."""
    if len(hole) != 2:
        raise ValueError("need 2 hole cards")
    rng = random.Random(seed)
    hero_norm = [c[0].upper() + c[1].lower() for c in hole]
    board_norm = [c[0].upper() + c[1].lower() for c in board]
    dead = set(hero_norm) | set(board_norm)

    wins = ties = trials = 0
    needed_board = 5 - len(board_norm)
    hero_str = "".join(hero_norm)
    board_str = "".join(board_norm)

    # Pre-build a list of candidate villain combos to avoid rebuilding each iter.
    villain_pool: list[tuple[str, str]] = []
    for code in range_set:
        if len(code) == 2:
            r = code[0]
            for s1, s2 in [("c","d"),("c","h"),("c","s"),("d","h"),("d","s"),("h","s")]:
                c1, c2 = f"{r}{s1}", f"{r}{s2}"
                if c1 not in dead and c2 not in dead:
                    villain_pool.append((c1, c2))
        else:
            hi, lo, sfx = code[0], code[1], code[2]
            if sfx == "s":
                for s in SUITS:
                    c1, c2 = f"{hi}{s}", f"{lo}{s}"
                    if c1 not in dead and c2 not in dead:
                        villain_pool.append((c1, c2))
            else:
                for s1 in SUITS:
                    for s2 in SUITS:
                        if s1 == s2: continue
                        c1, c2 = f"{hi}{s1}", f"{lo}{s2}"
                        if c1 not in dead and c2 not in dead:
                            villain_pool.append((c1, c2))
    if not villain_pool:
        return 0.5  # range collapsed to zero combos; neutral

    for _ in range(n):
        v1, v2 = rng.choice(villain_pool)
        remaining = [c for c in _FULL_DECK if c not in dead and c not in (v1, v2)]
        rng.shuffle(remaining)
        runout = remaining[:needed_board]
        full_board = board_str + "".join(runout)
        hero_h = StandardHighHand.from_game(hero_str, full_board)
        villain_h = StandardHighHand.from_game(v1 + v2, full_board)
        if hero_h > villain_h:
            wins += 1
        elif hero_h == villain_h:
            ties += 1
        trials += 1

    return (wins + ties * 0.5) / max(trials, 1)


def equity_summary(hole: list[str], board: list[str] | None = None) -> dict[str, float]:
    """Return equity vs each common range. board may be empty (preflop)."""
    board = board or []
    return {
        "vs_3bet_range": equity_vs_range(hole, board, RANGE_3BET, n=300),
        "vs_4bet_range": equity_vs_range(hole, board, RANGE_4BET, n=300),
        "vs_value_cbet": equity_vs_range(hole, board, RANGE_VALUE_CBET, n=300),
        "vs_wide_open":  equity_vs_range(hole, board, RANGE_WIDE_OPEN, n=300),
    }
