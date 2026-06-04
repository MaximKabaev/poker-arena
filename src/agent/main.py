"""Long-running poll loop. Run: `uv run agent` or `python -m agent.main`."""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import time
from datetime import datetime
from pathlib import Path

from .arena_client import ArenaClient, ArenaError, PaymentRequired, StaleStateError
from .config import Settings, load_credentials, load_style, save_credentials
from .context import DecisionContext
from .decide import decide
from .opponents import OpponentStatsCache
from .patterns import HandObserver, PatternRegistry
from .patterns.store import ActionStore
from .state import Decision, Table

log = logging.getLogger("agent")

POLL_INTERVAL_SECONDS = 1.5
LOBBY_POLL_SECONDS = 5.0
BENCHMARK_STATUS_SECONDS = 15.0


def _is_pve_benchmark(competition: dict) -> bool:
    """PVE benchmark mode uses /texas/benchmark/*; lobby mode uses /texas/join."""
    text = f"{competition.get('description') or ''} {competition.get('rules') or ''}".lower()
    return "pve" in text or "benchmark" in text


def _setup_logging(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    logfile = log_dir / f"agent-{stamp}.log"
    jsonl = log_dir / f"events-{stamp}.jsonl"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[logging.FileHandler(logfile), logging.StreamHandler()],
    )
    # httpcore is verbose (every connection event); httpx INFO shows request URLs
    # which IS useful for live debugging — keep httpx at INFO, silence httpcore only.
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    return jsonl


def _emit(jsonl: Path, kind: str, payload: dict) -> None:
    rec = {"ts": time.time(), "kind": kind, **payload}
    with jsonl.open("a") as f:
        f.write(json.dumps(rec, default=str) + "\n")


async def _ensure_registered(client: ArenaClient, settings: Settings) -> str:
    creds = load_credentials()
    if creds and creds.get("apiKey"):
        client.set_api_key(creds["apiKey"])
        log.info("loaded existing credentials for agentId=%s", creds.get("agentId"))
        return creds["apiKey"]
    if not (settings.agent_handle and settings.agent_name and settings.agent_quote):
        raise RuntimeError(
            "No credentials and AGENT_HANDLE / AGENT_NAME / AGENT_QUOTE not set in .env"
        )
    log.info("registering new agent handle=%s", settings.agent_handle)
    out = await client.register(
        handle=settings.agent_handle,
        name=settings.agent_name,
        quote=settings.agent_quote,
    )
    save_credentials(out)
    client.set_api_key(out["apiKey"])
    log.info("registered agentId=%s status=%s", out.get("agentId"), out.get("status"))
    return out["apiKey"]


async def _ensure_seated(
    client: ArenaClient, competition_id: str, is_benchmark: bool, jsonl: Path
) -> None:
    """Start a benchmark (PVE) or join the lobby (PVP)."""
    if is_benchmark:
        try:
            out = await client.benchmark_start(competition_id)
            _emit(jsonl, "benchmark_start", out)
            match = out.get("match") or {}
            log.info(
                "benchmark started status=%s phase=%s completed=%s/%s",
                match.get("status"), match.get("phase"),
                match.get("completedHands"), match.get("targetHands"),
            )
        except StaleStateError:
            log.info("benchmark already running, continuing")
        except ArenaError as e:
            log.error("benchmark start failed: %s payload=%s", e, e.payload)
            raise
        return

    try:
        out = await client.join(competition_id)
        _emit(jsonl, "join", out)
        log.info("join response kind=%s lobby=%s", out.get("kind"), out.get("lobby"))
    except PaymentRequired as e:
        log.error("entry fee required — pay from agent wallet and retry. payload=%s", e.payload)
        raise
    except StaleStateError:
        log.info("already in lobby or seated, continuing")


def _hand_signature(table: Table) -> tuple:
    """Identify a unique (hand, decision point) — used to avoid double-acting."""
    return (table.table_id, table.street.value, table.pot_chips, table.current_bet)


async def _handle_table(
    client: ArenaClient,
    table: Table,
    jsonl: Path,
    recently_acted: dict,
    cache: OpponentStatsCache,
    seen_tables: set[str],
    ctx: DecisionContext,
    state: dict,
    observer: HandObserver,
) -> None:
    if table.allowed_actions is None or table.self_seat_number != table.acting_seat_number:
        return
    sig = _hand_signature(table)
    if recently_acted.get(table.table_id) == sig:
        return  # already acted on this exact spot; server lag, skip.

    # Feed observations into the pattern store BEFORE deciding so the
    # registry has up-to-date data for this opponent.
    try:
        new_obs = observer.observe_table(table)
        if new_obs:
            observer.refresh_dirty()
    except Exception:
        log.debug("pattern observer failed", exc_info=True)

    if table.table_id not in seen_tables:
        seen_tables.add(table.table_id)
        asyncio.create_task(_refresh_opponents_bg(client, cache, table, jsonl))

    deadline = table.action_deadline_at
    budget_left = (deadline / 1000.0 - time.time()) if deadline else None
    _emit(jsonl, "table_snapshot", {
        "tableId": table.table_id,
        "street": table.street.value,
        "pot": table.pot_chips,
        "currentBet": table.current_bet,
        "selfSeat": table.self_seat_number,
        "actingSeat": table.acting_seat_number,
        "board": table.board_cards,
        "hole": table.hero_hole_cards,
        "budgetSecondsLeft": budget_left,
        "allowed": table.allowed_actions.available_actions,
        "blinds": {"small": table.small_blind_chips, "big": table.big_blind_chips},
        "seats": [
            {
                "seatNumber": s.seat_number,
                "agentHandle": s.agent_handle,
                "agentName": s.agent_name,
                "stackChips": s.stack_chips,
                "currentBetChips": s.current_bet_chips,
                "totalCommittedChips": s.total_committed_chips,
                "status": s.status.value,
                "holeCards": s.hole_cards,
            }
            for s in table.seats
        ],
        "recentActions": [
            {
                "seatNumber": ev.summary.seat_number,
                "action": ev.summary.action,
                "amount": ev.summary.amount,
                "toAmount": ev.summary.to_amount,
                "street": ev.street.value if ev.street else None,
            }
            for ev in table.recent_events
            if ev.type == "ActionTaken" and ev.summary
        ][-10:],
    })

    try:
        decision: Decision = await asyncio.wait_for(
            decide(table, ctx), timeout=ctx.settings.safety_budget_seconds
        )
    except (TimeoutError, Exception) as e:
        log.warning("decide failed (%s), falling back to safe-default", type(e).__name__)
        from .decide import safe_default
        decision = safe_default(table.allowed_actions)

    try:
        out = await client.submit_action(table.table_id, decision)
        recently_acted[table.table_id] = sig
        state[decision.layer] = state.get(decision.layer, 0) + 1
        _emit(jsonl, "action_submitted", {
            "tableId": table.table_id,
            "decision": decision.model_dump(),
            "ack": out.get("table", {}).get("street") if isinstance(out, dict) else None,
        })
        log.info(
            "acted street=%s action=%s amount=%s layer=%s lat=%.0fms "
            "| L1=%d L2=%d safe=%d | bb/100=%+.2f @ hand %d/%d",
            table.street.value, decision.action, decision.amount,
            decision.layer, decision.latency_ms,
            state["L1"], state["L2"], state["safe"],
            state["last_bb"], state["last_hands"], state["target_hands"],
        )
    except StaleStateError:
        log.info("table moved on before action landed, will re-poll")
    except Exception as e:
        log.exception("action submit failed: %s", e)


async def _refresh_opponents_bg(
    client: ArenaClient, cache: OpponentStatsCache, table: Table, jsonl: Path
) -> None:
    """Best-effort background refresh of opponent stats on table entry."""
    try:
        stats = await cache.refresh_table_opponents(client, table)
        _emit(jsonl, "opponent_stats", {
            "tableId": table.table_id,
            "stats": {aid: s.summary_line() for aid, s in stats.items()},
        })
        if stats:
            log.info(
                "opponent stats table=%s :: %s",
                table.table_id,
                " | ".join(f"{aid[:8]}:{s.summary_line()}" for aid, s in stats.items()),
            )
    except Exception as e:
        log.debug("background opponent refresh failed: %s", e)


async def _poll_forever(
    client: ArenaClient,
    settings: Settings,
    is_benchmark: bool,
    cache: OpponentStatsCache,
    ctx: DecisionContext,
    observer: HandObserver,
    jsonl: Path,
    shutdown: asyncio.Event,
) -> None:
    recently_acted: dict[str, tuple] = {}
    seen_tables: set[str] = set()
    # Shared state — layer counters + most recent score, used in per-hand log.
    state: dict = {
        "L1": 0, "L2": 0, "L3": 0, "safe": 0,
        "last_bb": 0.0, "last_hands": 0, "target_hands": 0,
    }
    last_idle_check = 0.0
    while True:
        # Graceful shutdown: finish the current iteration but don't start a new poll.
        if shutdown.is_set():
            log.info(
                "graceful shutdown complete. layers L1=%d L2=%d safe=%d "
                "last_bb=%+.2f hands=%d",
                state["L1"], state["L2"], state["safe"],
                state["last_bb"], state["last_hands"],
            )
            return
        try:
            resp = await client.pending_actions(settings.competition_id)
            if resp.tables:
                for table in resp.tables:
                    await _handle_table(
                        client, table, jsonl, recently_acted, cache, seen_tables, ctx,
                        state, observer,
                    )
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            now = time.time()
            if is_benchmark:
                if now - last_idle_check > BENCHMARK_STATUS_SECONDS:
                    try:
                        st = await client.benchmark_status(settings.competition_id)
                        _emit(jsonl, "benchmark_status", st)
                        m = st.get("match") or {}
                        state["last_bb"] = float(m.get("rawBbPer100") or 0.0)
                        state["last_hands"] = int(m.get("completedHands") or 0)
                        state["target_hands"] = int(m.get("targetHands") or 0)
                        log.info(
                            "benchmark phase=%s status=%s hands=%d/%d rawBb/100=%+.2f "
                            "| layers L1=%d L2=%d safe=%d",
                            m.get("phase"), m.get("status"),
                            state["last_hands"], state["target_hands"], state["last_bb"],
                            state["L1"], state["L2"], state["safe"],
                        )
                        if m.get("status") in ("Completed", "Cancelled", "Failed"):
                            log.info(
                                "benchmark finished. final layers: L1=%d L2=%d safe=%d "
                                "rawBb/100=%+.2f",
                                state["L1"], state["L2"], state["safe"], state["last_bb"],
                            )
                            return
                    except Exception as e:
                        log.debug("benchmark status failed: %s", e)
                    last_idle_check = now
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
            else:
                if now - last_idle_check > LOBBY_POLL_SECONDS:
                    try:
                        lob = await client.lobby(settings.competition_id)
                        _emit(jsonl, "lobby", lob)
                        log.info("lobby=%s", lob.get("lobby"))
                    except Exception as e:
                        log.debug("lobby poll failed: %s", e)
                    last_idle_check = now
                await asyncio.sleep(LOBBY_POLL_SECONDS)
        except StaleStateError:
            await asyncio.sleep(0.5)
        except Exception:
            log.exception("poll loop iteration failed")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def main() -> None:
    settings = Settings()
    if not settings.competition_id:
        raise RuntimeError("COMPETITION_ID not set — fetch one via /competition/list-active and set in .env")
    jsonl = _setup_logging(settings.log_dir)
    log.info("starting agent base=%s competition=%s", settings.arena_base_url, settings.competition_id)
    cache = OpponentStatsCache(settings.db_path)
    pattern_store = ActionStore(settings.db_path.parent / "patterns.sqlite")
    registry = PatternRegistry(pattern_store)
    observer = HandObserver(pattern_store, registry)
    style = load_style()
    ctx = DecisionContext(settings=settings, cache=cache, registry=registry, style=style)
    log.info(
        "L2 enabled=%s model=%s style_loaded=%s patterns=enabled",
        bool(settings.openai_api_key), settings.llm_model, bool(style),
    )

    # Graceful shutdown — first Ctrl-C requests it (current action finishes,
    # loop exits cleanly). Second Ctrl-C forces cancellation.
    shutdown = asyncio.Event()
    sigint_count = 0

    def _on_signal() -> None:
        nonlocal sigint_count
        sigint_count += 1
        if sigint_count == 1:
            log.warning(
                "shutdown requested — finishing current action then exiting. "
                "Press Ctrl-C again to force-quit."
            )
            shutdown.set()
        else:
            log.warning("force-quit on second Ctrl-C")
            raise KeyboardInterrupt

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            pass

    try:
        async with ArenaClient(settings.arena_base_url) as client:
            await _ensure_registered(client, settings)
            comp = await client.competition_info(settings.competition_id)
            is_benchmark = _is_pve_benchmark(comp)
            log.info(
                "competition=%s mode=%s status=%s",
                comp.get("name"), "PVE-benchmark" if is_benchmark else "PVP-lobby",
                comp.get("status"),
            )
            await _ensure_seated(client, settings.competition_id, is_benchmark, jsonl)
            await _poll_forever(client, settings, is_benchmark, cache, ctx, observer, jsonl, shutdown)
    finally:
        cache.close()
        pattern_store.close()


def run() -> None:
    # Signal handlers are installed inside main() now so they can talk to the
    # shutdown event directly. asyncio.run() handles event-loop lifecycle.
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.warning("hard exit on KeyboardInterrupt")


if __name__ == "__main__":
    run()
