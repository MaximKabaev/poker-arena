"""DecisionContext bundles everything a decision layer might consult.

Threaded through `decide()` so call sites stay stable when layers grow.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .opponents import OpponentStatsCache
from .patterns import PatternRegistry


@dataclass(frozen=True)
class DecisionContext:
    settings: Settings
    cache: OpponentStatsCache | None = None
    registry: PatternRegistry | None = None
    style: str = ""
