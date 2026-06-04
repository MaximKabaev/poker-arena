"""Pattern detectors — convert (opponent, spot) observations into exploits.

Phase 1 ships one pattern: fold-to-3bet. Each detector is a small function
that takes the observation counts and returns either a Pattern or None.
"""

from __future__ import annotations

from dataclasses import dataclass

from .spots import SpotType
from .store import ActionStore

MIN_SAMPLE = 15            # observations of the spot before pattern can trigger
MIN_SAMPLE_POSTFLOP = 10   # postflop samples accumulate slower
HIGH_CONFIDENCE = 0.70     # frequency threshold for "exploit me" pattern


@dataclass(frozen=True)
class Pattern:
    name: str                # e.g. "fold_to_3bet"
    spot: SpotType           # spot it applies to
    confidence: float        # 0..1, fraction observed
    sample: int              # supporting observations
    recommendation: str      # e.g. "3bet wider as bluff"

    def summary(self) -> str:
        return f"{self.name}@{self.spot.value} conf={self.confidence:.0%} n={self.sample}"


def _fold_to_3bet(
    store: ActionStore, competition_id: str, agent_id: str
) -> Pattern | None:
    """Opponent folds to 3-bet at >70%, ≥15 sample size."""
    counts = store.counts(competition_id, agent_id, SpotType.FACING_3BET)
    total = sum(counts.values())
    if total < MIN_SAMPLE:
        return None
    folds = counts.get("fold", 0)
    rate = folds / total
    if rate < HIGH_CONFIDENCE:
        return None
    return Pattern(
        name="fold_to_3bet",
        spot=SpotType.FACING_3BET,
        confidence=rate,
        sample=total,
        recommendation="3bet wider as bluff vs this opener",
    )


def _c_bet_whiff(
    store: ActionStore, competition_id: str, agent_id: str
) -> Pattern | None:
    """As PFR on the flop, this opponent checks (gives up the c-bet) ≥70%, ≥10 sample."""
    counts = store.counts(competition_id, agent_id, SpotType.PFR_CBET_FLOP)
    total = sum(counts.values())
    if total < MIN_SAMPLE_POSTFLOP:
        return None
    checks = counts.get("check", 0)
    rate = checks / total
    if rate < HIGH_CONFIDENCE:
        return None
    return Pattern(
        name="c_bet_whiff",
        spot=SpotType.PFR_CBET_FLOP,
        confidence=rate,
        sample=total,
        recommendation="when checked to, bet to steal — they're giving up the pot",
    )


def _folds_to_cbet(
    store: ActionStore, competition_id: str, agent_id: str
) -> Pattern | None:
    """As caller, this opponent folds to a flop c-bet ≥70%, ≥10 sample."""
    counts = store.counts(competition_id, agent_id, SpotType.CALLER_FACING_CBET)
    total = sum(counts.values())
    if total < MIN_SAMPLE_POSTFLOP:
        return None
    folds = counts.get("fold", 0)
    rate = folds / total
    if rate < HIGH_CONFIDENCE:
        return None
    return Pattern(
        name="folds_to_cbet",
        spot=SpotType.CALLER_FACING_CBET,
        confidence=rate,
        sample=total,
        recommendation="as PFR, c-bet wider — they fold the flop too often",
    )


# All registered detectors. Each takes (store, competition_id, agent_id) → Pattern | None.
DETECTORS = [_fold_to_3bet, _c_bet_whiff, _folds_to_cbet]


def detect_patterns(
    store: ActionStore, competition_id: str, agent_id: str
) -> list[Pattern]:
    """Run every detector against this opponent. Return active patterns."""
    out: list[Pattern] = []
    for d in DETECTORS:
        p = d(store, competition_id, agent_id)
        if p is not None:
            out.append(p)
    return out
