"""Thin typed HTTP client for the dev.fun Arena Texas Holdem API.

All endpoints documented at https://arena.dev.fun/api/arena/__introspection.
Call refresh_introspection() at startup; treat the live schema as the
source of truth — this client is a convenience layer over the same shapes.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from .state import Decision, PendingActionsResponse, Table

ARENA_PREFIX = "/api/arena"


class ArenaError(RuntimeError):
    def __init__(self, status: int, message: str, payload: Any = None):
        super().__init__(f"[{status}] {message}")
        self.status = status
        self.payload = payload


class PaymentRequired(ArenaError):
    """402 — entry-fee handshake required."""


class StaleStateError(ArenaError):
    """409 / table moved on — re-poll pending-actions instead of retrying."""


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError)):
        return True
    if isinstance(exc, ArenaError) and exc.status in (500, 502, 503, 504):
        return True
    return False


class ArenaClient:
    def __init__(self, base_url: str, api_key: str | None = None, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            http2=True,
            headers={"accept": "application/json"},
        )
        if api_key:
            self._client.headers["x-arena-api-key"] = api_key

    def set_api_key(self, api_key: str) -> None:
        self._client.headers["x-arena-api-key"] = api_key

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "ArenaClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    @retry(
        retry=retry_if_exception(_retryable),
        wait=wait_exponential(multiplier=0.3, min=0.3, max=3.0),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        full = f"{ARENA_PREFIX}{path}"
        resp = await self._client.request(method, full, **kwargs)
        if resp.status_code == 402:
            raise PaymentRequired(402, "entry fee required", resp.json())
        if resp.status_code == 409:
            raise StaleStateError(409, "stale or conflicting state", resp.text)
        if resp.status_code >= 400:
            try:
                payload = resp.json()
            except Exception:
                payload = resp.text
            raise ArenaError(resp.status_code, str(payload)[:300], payload)
        return resp.json() if resp.content else None

    # ----- discovery -----

    async def introspection(self) -> dict:
        return await self._request("GET", "/__introspection")

    async def list_active_competitions(self) -> dict:
        return await self._request("GET", "/competition/list-active")

    async def competition_info(self, competition_id: str) -> dict:
        return await self._request(
            "GET", "/competition", params={"competitionId": competition_id}
        )

    async def leaderboard(self, competition_id: str, limit: int = 100) -> dict:
        return await self._request(
            "GET", "/competition/leaderboard",
            params={"competitionId": competition_id, "limit": limit},
        )

    # ----- auth -----

    async def register(self, handle: str, name: str, quote: str, description: str = "") -> dict:
        return await self._request(
            "POST", "/auth/register",
            json={"handle": handle, "name": name, "quote": quote, "description": description},
        )

    async def me(self) -> dict:
        return await self._request("GET", "/agent/me")

    # ----- texas hold'em -----

    async def join(self, competition_id: str, tx_hash: str | None = None) -> dict:
        body: dict[str, Any] = {"competitionId": competition_id}
        if tx_hash:
            body["txHash"] = tx_hash
        return await self._request("POST", "/texas/join", json=body)

    async def benchmark_start(self, competition_id: str) -> dict:
        return await self._request(
            "POST", "/texas/benchmark/start", json={"competitionId": competition_id}
        )

    async def benchmark_status(self, competition_id: str) -> dict:
        return await self._request(
            "GET", "/texas/benchmark/status", params={"competitionId": competition_id}
        )

    async def lobby(self, competition_id: str) -> dict:
        return await self._request(
            "GET", "/texas/lobby", params={"competitionId": competition_id}
        )

    async def pending_actions(self, competition_id: str) -> PendingActionsResponse:
        raw = await self._request(
            "GET", "/texas/pending-actions",
            params={"competitionId": competition_id},
        )
        return PendingActionsResponse.model_validate(raw)

    async def submit_action(self, table_id: str, decision: Decision) -> dict:
        body: dict[str, Any] = {
            "tableId": table_id,
            "action": decision.action,
            "message": (decision.message or "gg")[:500],
        }
        if decision.amount is not None and decision.action in ("bet", "raise", "all-in"):
            body["amount"] = decision.amount
        if decision.reasoning:
            body["reasoning"] = decision.reasoning[:150]
        return await self._request("POST", "/texas/action", json=body)

    async def agent_stats(self, competition_id: str, agent_id: str) -> dict:
        return await self._request(
            "GET", "/texas/agent-stats",
            params={"competitionId": competition_id, "agentId": agent_id},
        )

    async def recent_tables(self, competition_id: str, limit: int = 20) -> dict:
        return await self._request(
            "GET", "/texas/recent-tables",
            params={"competitionId": competition_id, "limit": limit},
        )
