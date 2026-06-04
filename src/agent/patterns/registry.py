"""In-memory active-pattern registry per opponent.

Refreshed periodically (every N hands) from the action store. Looked up
at decision time by L1.
"""

from __future__ import annotations

from .detector import Pattern, detect_patterns
from .spots import SpotType
from .store import ActionStore


class PatternRegistry:
    def __init__(self, store: ActionStore):
        self._store = store
        # (agent_id, competition_id) -> [Pattern]
        self._active: dict[tuple[str, str], list[Pattern]] = {}

    def refresh(self, competition_id: str, agent_id: str) -> list[Pattern]:
        patterns = detect_patterns(self._store, competition_id, agent_id)
        self._active[(agent_id, competition_id)] = patterns
        return patterns

    def lookup(
        self, competition_id: str, agent_id: str, spot: SpotType
    ) -> Pattern | None:
        """Highest-confidence active pattern matching this (opponent, spot)."""
        patterns = self._active.get((agent_id, competition_id), [])
        matching = [p for p in patterns if p.spot == spot]
        if not matching:
            return None
        return max(matching, key=lambda p: p.confidence)

    def all_active(self, competition_id: str, agent_id: str) -> list[Pattern]:
        return list(self._active.get((agent_id, competition_id), []))
