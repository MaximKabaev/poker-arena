"""SQLite-backed store of observed (opponent, spot, outcome) actions.

One row per observed action. Keep it append-only; aggregation happens at
read time. That keeps writes O(1) and lets us recompute pattern stats
with new thresholds without re-parsing JSONL.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from .spots import SpotType

_SCHEMA = """
CREATE TABLE IF NOT EXISTS opponent_actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id  TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    table_id        TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    spot            TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    observed_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_agent_spot
    ON opponent_actions(agent_id, competition_id, spot);
CREATE INDEX IF NOT EXISTS idx_actions_dedup
    ON opponent_actions(table_id, agent_id, sequence);
"""


class ActionStore:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def record(
        self,
        competition_id: str,
        agent_id: str,
        table_id: str,
        sequence: int,
        spot: SpotType,
        outcome: str,
    ) -> bool:
        """Record one observation. Returns True if inserted, False if duplicate."""
        existing = self._conn.execute(
            "SELECT 1 FROM opponent_actions WHERE table_id=? AND agent_id=? AND sequence=?",
            (table_id, agent_id, sequence),
        ).fetchone()
        if existing is not None:
            return False
        self._conn.execute(
            "INSERT INTO opponent_actions "
            "(competition_id, agent_id, table_id, sequence, spot, outcome, observed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (competition_id, agent_id, table_id, sequence, spot.value, outcome, int(time.time())),
        )
        self._conn.commit()
        return True

    def counts(
        self, competition_id: str, agent_id: str, spot: SpotType
    ) -> dict[str, int]:
        """Return {outcome: count} for opponent in spot."""
        rows = self._conn.execute(
            "SELECT outcome, COUNT(*) as n FROM opponent_actions "
            "WHERE competition_id=? AND agent_id=? AND spot=? GROUP BY outcome",
            (competition_id, agent_id, spot.value),
        ).fetchall()
        return {row["outcome"]: row["n"] for row in rows}

    def total_observed(self, competition_id: str, agent_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as n FROM opponent_actions "
            "WHERE competition_id=? AND agent_id=?",
            (competition_id, agent_id),
        ).fetchone()
        return row["n"] if row else 0
