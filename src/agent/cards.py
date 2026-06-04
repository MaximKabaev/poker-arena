"""Card and hand-code primitives.

dev.fun cards are 2-char strings like 'As', 'Td', '9h', '2c'. Hand codes
follow the standard 169-bucket notation: 'AA', 'AKs', 'AKo'.
"""

from __future__ import annotations

RANKS = "23456789TJQKA"
RANK_VAL = {r: i + 2 for i, r in enumerate(RANKS)}
SUITS = "cdhs"


def parse_card(s: str) -> tuple[str, str]:
    if len(s) != 2:
        raise ValueError(f"bad card {s!r}")
    r, suit = s[0].upper(), s[1].lower()
    if r not in RANKS or suit not in SUITS:
        raise ValueError(f"bad card {s!r}")
    return r, suit


def hand_code(c1: str, c2: str) -> str:
    r1, s1 = parse_card(c1)
    r2, s2 = parse_card(c2)
    if r1 == r2:
        return r1 + r2
    hi, lo = (r1, r2) if RANK_VAL[r1] > RANK_VAL[r2] else (r2, r1)
    return f"{hi}{lo}{'s' if s1 == s2 else 'o'}"


def expand_range(spec: str) -> frozenset[str]:
    """Expand poker-range shorthand into a set of 169-bucket codes.

    Supported tokens (comma- or space-separated):
      AA, KK, ...        single pair
      TT+                pair and higher
      AKs, AKo           single suited/offsuit
      AJs+, AJo+         lo card widens to high card
    """
    result: set[str] = set()
    for raw in spec.replace(",", " ").split():
        item = raw.strip()
        if not item:
            continue
        if item.endswith("+"):
            result |= _plus_expand(item[:-1])
        else:
            result.add(item)
    return frozenset(result)


def _plus_expand(base: str) -> set[str]:
    if len(base) == 2:
        r = base[0]
        idx = RANKS.index(r)
        return {f"{x}{x}" for x in RANKS[idx:]}
    if len(base) == 3:
        hi, lo, sfx = base[0], base[1], base[2]
        hi_idx, lo_idx = RANKS.index(hi), RANKS.index(lo)
        return {f"{hi}{RANKS[i]}{sfx}" for i in range(lo_idx, hi_idx)}
    raise ValueError(f"unsupported range token {base!r}")
