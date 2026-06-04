"""Observe table events as they come in; feed structured observations to the store.

Called from the polling loop on every fresh pending-actions response. Iterates
the table's `recent_events`, classifies each ActionTaken, and writes the
result (deduped by (table_id, agent_id, sequence)).

Hero's own actions are skipped — we're profiling opponents.
"""

from __future__ import annotations

import logging

from ..state import Street, Table
from .registry import PatternRegistry
from .spots import classify_action
from .store import ActionStore

log = logging.getLogger("agent.patterns")


class HandObserver:
    """Pulls observations off live tables and updates the registry."""

    def __init__(self, store: ActionStore, registry: PatternRegistry):
        self.store = store
        self.registry = registry
        # Track refresh cadence per opponent so we don't re-detect every poll.
        self._dirty: set[tuple[str, str]] = set()

    def observe_table(self, table: Table) -> int:
        """Record every observable action on this table. Returns # new inserts."""
        new = 0
        for ev in table.recent_events:
            if ev.type != "ActionTaken" or ev.summary is None:
                continue
            actor_seat = ev.summary.seat_number
            if actor_seat is None or actor_seat == table.self_seat_number:
                continue  # skip hero
            actor = next(
                (s for s in table.seats if s.seat_number == actor_seat),
                None,
            )
            if actor is None or not actor.agent_id:
                continue
            action = ev.summary.action
            if not action:
                continue
            street = ev.street or Street.PREFLOP
            spot, outcome = classify_action(
                table, actor_seat, action, street, ev.sequence
            )
            if self.store.record(
                competition_id=table.competition_id,
                agent_id=actor.agent_id,
                table_id=table.table_id,
                sequence=ev.sequence,
                spot=spot,
                outcome=outcome,
            ):
                new += 1
                self._dirty.add((actor.agent_id, table.competition_id))
        return new

    def refresh_dirty(self) -> int:
        """Re-run detectors for every opponent who got new observations."""
        n = 0
        for agent_id, competition_id in list(self._dirty):
            patterns = self.registry.refresh(competition_id, agent_id)
            for p in patterns:
                log.info("pattern active for %s :: %s", agent_id[:12], p.summary())
            n += 1
        self._dirty.clear()
        return n
