"""Monte Carlo equity estimation.

`equity_vs_random` is the cheap default: hero's hand vs an unknown two-card
villain hand, completing the board. Returns win-fraction + tie/2.

At pokerkit's lookup speed this is ~10-30ms for n=200 — fast enough to call
on every L2 decision. Deterministic with a seed.
"""

from __future__ import annotations

import random
from itertools import product

from pokerkit import StandardHighHand

from ..cards import RANKS, SUITS

_FULL_DECK: tuple[str, ...] = tuple(f"{r}{s}" for r, s in product(RANKS, SUITS))


def _build_deck(used: set[str]) -> list[str]:
    used_norm = {c[0].upper() + c[1].lower() for c in used}
    return [c for c in _FULL_DECK if c not in used_norm]


def equity_vs_random(
    hole: list[str], board: list[str], n: int = 200, seed: int | None = 42
) -> float:
    if len(hole) != 2:
        raise ValueError("need exactly 2 hole cards")
    rng = random.Random(seed)
    deck = _build_deck(set(hole) | set(board))
    needed_board = 5 - len(board)
    if needed_board < 0:
        raise ValueError("board has more than 5 cards")

    hero_str = "".join(hole)
    board_str = "".join(board)
    wins = ties = 0
    for _ in range(n):
        rng.shuffle(deck)
        v_hole = deck[:2]
        runout = deck[2 : 2 + needed_board]
        full_board = board_str + "".join(runout)
        hero_h = StandardHighHand.from_game(hero_str, full_board)
        villain_h = StandardHighHand.from_game("".join(v_hole), full_board)
        if hero_h > villain_h:
            wins += 1
        elif hero_h == villain_h:
            ties += 1
    return (wins + ties * 0.5) / n
