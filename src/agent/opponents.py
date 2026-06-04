"""Opponent stats cache, backed by SQLite.

dev.fun exposes `GET /api/arena/texas/agent-stats` which returns VPIP, PFR,
3-bet%, AF, bluff%, WTSD, WSD, and a derived playingStyle archetype for any
agent in a competition. The docs say these are cached server-side and stable
across calls — fetch once per opponent and reuse rather than polling.

This module wraps that endpoint:
- Persistent SQLite storage so stats survive process restarts.
- TTL invalidation (default 30 min) — server values are stable, but we want
  occasional refreshes as opponents accumulate more hands.
- Bulk refresh helper that pulls stats for every seated opponent on a table.

Null fields from the API mean "no read yet" (sub-sample-size); they're stored
as None and surfaced as None to callers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from .arena_client import ArenaClient, ArenaError
from .state import Table

log = logging.getLogger("agent.opponents")

DEFAULT_TTL_SECONDS = 60 * 60  # 1 hour
MAX_CONSECUTIVE_FAILURES = 3
FAILURE_COOLDOWN_SECONDS = 5 * 60  # 5 min


@dataclass(frozen=True)
class PlayingStyle:
    label: str
    tightness: str  # tight | balanced | loose
    aggression: str  # passive | measured | aggressive
    archetype: str
    tagline: str


@dataclass(frozen=True)
class OpponentStats:
    agent_id: str
    competition_id: str
    sample_size: int
    vpip: float | None
    pfr: float | None
    three_bet_pct: float | None
    af: float | None
    bluff_pct: float | None
    wtsd: float | None
    wsd: float | None
    playing_style: PlayingStyle | None
    fetched_at: int  # unix seconds

    @property
    def is_fresh(self) -> bool:
        return time.time() - self.fetched_at < DEFAULT_TTL_SECONDS

    def summary_line(self) -> str:
        """One-line digest suitable for an LLM prompt or log message."""
        bits = [f"n={self.sample_size}"]
        if self.vpip is not None:
            bits.append(f"VPIP={int(self.vpip * 100)}")
        if self.pfr is not None:
            bits.append(f"PFR={int(self.pfr * 100)}")
        if self.three_bet_pct is not None:
            bits.append(f"3B={self.three_bet_pct * 100:.1f}")
        if self.af is not None:
            bits.append(f"AF={self.af:.1f}")
        if self.wtsd is not None:
            bits.append(f"WTSD={int(self.wtsd * 100)}")
        if self.wsd is not None:
            bits.append(f"WSD={int(self.wsd * 100)}")
        if self.playing_style:
            bits.append(f"style={self.playing_style.archetype}")
        return " ".join(bits)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS opponent_stats (
    agent_id        TEXT NOT NULL,
    competition_id  TEXT NOT NULL,
    sample_size     INTEGER NOT NULL,
    vpip            REAL,
    pfr             REAL,
    three_bet_pct   REAL,
    af              REAL,
    bluff_pct       REAL,
    wtsd            REAL,
    wsd             REAL,
    playing_style   TEXT,
    raw_json        TEXT NOT NULL,
    fetched_at      INTEGER NOT NULL,
    PRIMARY KEY (agent_id, competition_id)
);
"""


def _parse(raw: dict, fetched_at: int) -> OpponentStats:
    ps = raw.get("playingStyle")
    style = (
        PlayingStyle(
            label=ps.get("label", ""),
            tightness=ps.get("tightness", ""),
            aggression=ps.get("aggression", ""),
            archetype=ps.get("archetype", ""),
            tagline=ps.get("tagline", ""),
        )
        if isinstance(ps, dict) else None
    )
    return OpponentStats(
        agent_id=raw["agentId"],
        competition_id=raw["competitionId"],
        sample_size=raw.get("sampleSize", 0),
        vpip=raw.get("vpip"),
        pfr=raw.get("pfr"),
        three_bet_pct=raw.get("threeBetPct"),
        af=raw.get("af"),
        bluff_pct=raw.get("bluffPct"),
        wtsd=raw.get("wtsd"),
        wsd=raw.get("wsd"),
        playing_style=style,
        fetched_at=fetched_at,
    )


class OpponentStatsCache:
    def __init__(self, db_path: Path, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()
        self._ttl = ttl_seconds
        # Circuit breaker — server returns 500 on agent-stats for some agents.
        # After N consecutive failures, cool down for a while and stop pinging.
        self._fail_count: dict[str, int] = {}
        self._fail_cooldown_until: dict[str, float] = {}
        # Per-agent locks so concurrent background fetches don't race past the
        # cooldown check (the "9 failures, 10 failures" bursts were this race).
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, agent_id: str) -> asyncio.Lock:
        lock = self._locks.get(agent_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[agent_id] = lock
        return lock

    def close(self) -> None:
        self._conn.close()

    def get(self, agent_id: str, competition_id: str) -> OpponentStats | None:
        row = self._conn.execute(
            "SELECT * FROM opponent_stats WHERE agent_id = ? AND competition_id = ?",
            (agent_id, competition_id),
        ).fetchone()
        if row is None:
            return None
        if time.time() - row["fetched_at"] >= self._ttl:
            return None  # stale; caller should re-fetch
        raw = json.loads(row["raw_json"])
        return _parse(raw, row["fetched_at"])

    def put(self, raw: dict) -> OpponentStats:
        now = int(time.time())
        ps = raw.get("playingStyle")
        ps_label = ps.get("label") if isinstance(ps, dict) else None
        self._conn.execute(
            """
            INSERT INTO opponent_stats (
                agent_id, competition_id, sample_size,
                vpip, pfr, three_bet_pct, af, bluff_pct, wtsd, wsd,
                playing_style, raw_json, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(agent_id, competition_id) DO UPDATE SET
                sample_size=excluded.sample_size,
                vpip=excluded.vpip,
                pfr=excluded.pfr,
                three_bet_pct=excluded.three_bet_pct,
                af=excluded.af,
                bluff_pct=excluded.bluff_pct,
                wtsd=excluded.wtsd,
                wsd=excluded.wsd,
                playing_style=excluded.playing_style,
                raw_json=excluded.raw_json,
                fetched_at=excluded.fetched_at
            """,
            (
                raw["agentId"], raw["competitionId"], raw.get("sampleSize", 0),
                raw.get("vpip"), raw.get("pfr"), raw.get("threeBetPct"),
                raw.get("af"), raw.get("bluffPct"), raw.get("wtsd"), raw.get("wsd"),
                ps_label, json.dumps(raw), now,
            ),
        )
        self._conn.commit()
        return _parse(raw, now)

    async def fetch(
        self, client: ArenaClient, competition_id: str, agent_id: str, force: bool = False
    ) -> OpponentStats | None:
        async with self._lock_for(agent_id):
            cooldown = self._fail_cooldown_until.get(agent_id, 0.0)
            if time.time() < cooldown:
                return None
            if not force:
                hit = self.get(agent_id, competition_id)
                if hit is not None:
                    return hit
            try:
                raw = await client.agent_stats(competition_id, agent_id)
            except ArenaError as e:
                n = self._fail_count.get(agent_id, 0) + 1
                self._fail_count[agent_id] = n
                if n >= MAX_CONSECUTIVE_FAILURES:
                    self._fail_cooldown_until[agent_id] = (
                        time.time() + FAILURE_COOLDOWN_SECONDS
                    )
                    log.warning(
                        "agent-stats circuit-broken for %s (%d failures, cooling %ds)",
                        agent_id, n, FAILURE_COOLDOWN_SECONDS,
                    )
                else:
                    log.debug("agent_stats fetch failed for %s: %s", agent_id, e)
                return None
            # Success — reset the breaker.
            self._fail_count.pop(agent_id, None)
            self._fail_cooldown_until.pop(agent_id, None)
            return self.put(raw)

    async def refresh_table_opponents(
        self, client: ArenaClient, table: Table
    ) -> dict[str, OpponentStats]:
        """Refresh stats for every seated opponent on the given table."""
        result: dict[str, OpponentStats] = {}
        for seat in table.seats:
            if seat.seat_number == table.self_seat_number:
                continue
            if not seat.agent_id:
                continue
            stats = await self.fetch(client, table.competition_id, seat.agent_id)
            if stats is not None:
                result[seat.agent_id] = stats
        return result
