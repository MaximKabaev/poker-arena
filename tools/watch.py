"""Live dashboard for watching the agent.

Run from project root in a second terminal:

    uv run python tools/watch.py

Polls the Arena API every 5s for standings + last-10 hand outcomes, and
tails the latest `logs/events-*.jsonl` file for live decisions as they
happen. Press Ctrl-C to stop the watcher — it does not affect the agent.

Read-only. Never submits actions, never reads-then-writes credentials.
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import httpx  # noqa: E402
from pokerkit import StandardHighHand  # noqa: E402

from agent.config import Settings, load_credentials  # noqa: E402

API_REFRESH = 5.0
RENDER_REFRESH = 1.0

CLEAR = "\033[H\033[2J"        # cursor home, then clear from there down
ENTER_ALT = "\033[?1049h"       # enter alternate screen buffer (like vim)
EXIT_ALT = "\033[?1049l"        # restore original terminal
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
WHITE = "\033[97m"
RESET = "\033[0m"

SUIT_GLYPH = {"s": "♠", "h": "♥", "d": "♦", "c": "♣"}


def _fmt_card(c: str) -> str:
    """Render '7h' as red '7♥', '7c' as bold black '7♣'."""
    if not c or len(c) != 2:
        return c or "?"
    rank, suit = c[0].upper(), c[1].lower()
    glyph = SUIT_GLYPH.get(suit, suit)
    color = RED if suit in ("h", "d") else WHITE
    return f"{color}{rank}{glyph}{RESET}"


def _fmt_cards(cards: list[str]) -> str:
    return " ".join(f"[{_fmt_card(c)}]" for c in (cards or []))


def _made_hand_label(hole: list[str] | None, board: list[str] | None) -> str:
    if not hole:
        return "no hole cards"
    if not board:
        return "preflop"
    if len(board) < 3:
        return "—"
    try:
        h = StandardHighHand.from_game("".join(hole), "".join(board))
        return h.entry.label.value
    except Exception:
        return "?"


_STATUS_TAG = {
    "Active": f"{GREEN}●{RESET}",
    "Folded": f"{DIM}✕{RESET}",
    "AllIn": f"{YELLOW}⚡{RESET}",
    "Settled": f"{DIM}·{RESET}",
    "Pending": f"{DIM}◌{RESET}",
}


def _render_table(out: list[str], t: dict) -> None:
    """Render the table view: board in the middle, players listed in seat order."""
    bar = "═" * 64
    street = t.get("street") or "?"
    pot = t.get("pot")
    blinds = t.get("blinds") or {}
    sb = blinds.get("small", "?")
    bb = blinds.get("big", "?")
    board = t.get("board") or []
    hole = t.get("hole") or []
    self_seat = t.get("selfSeat")
    acting_seat = t.get("actingSeat")
    seats = t.get("seats") or []
    recent = t.get("recentActions") or []
    allowed = t.get("allowed") or []

    out.append(f"{BOLD}╔{bar}╗{RESET}")
    # Header: street + pot + blinds
    out.append(
        f"  {BOLD}{street:<8}{RESET}  pot {CYAN}{BOLD}{pot}{RESET}  "
        f"blinds {sb}/{bb}  current bet {t.get('currentBet') or 0}"
    )
    # Board
    if board:
        out.append(f"  board: {_fmt_cards(board)}")
    else:
        out.append(f"  board: {DIM}(none yet — preflop){RESET}")
    out.append(f"{DIM}{bar}{RESET}")

    # Last few actions on this hand
    if recent:
        out.append(f"  {BOLD}Action history (newest last):{RESET}")
        for a in recent[-6:]:
            seat_num = a.get("seatNumber")
            seat = next((s for s in seats if s.get("seatNumber") == seat_num), {})
            handle = (seat.get("agentHandle") or seat.get("agentName") or f"seat{seat_num}")[:18]
            you = " (YOU)" if seat_num == self_seat else ""
            action = a.get("action") or "?"
            to_amt = a.get("toAmount")
            amt_str = f" to {to_amt}" if to_amt else ""
            st = a.get("street") or ""
            out.append(
                f"    [{st:<7}] {handle:<18}{you:<6} → {action}{amt_str}"
            )
        out.append(f"{DIM}{bar}{RESET}")

    # Seats
    out.append(f"  {BOLD}Seats:{RESET}")
    for s in sorted(seats, key=lambda x: x.get("seatNumber") or 0):
        seat_num = s.get("seatNumber")
        is_hero = seat_num == self_seat
        is_acting = seat_num == acting_seat
        handle = (s.get("agentHandle") or s.get("agentName") or "?")[:20]
        stack = s.get("stackChips", "?")
        in_pot = s.get("currentBetChips", 0) or 0
        committed = s.get("totalCommittedChips", 0)
        status = s.get("status", "?")
        status_glyph = _STATUS_TAG.get(status, "?")

        prefix = f"  {YELLOW}{BOLD}▶{RESET} " if is_acting else "    "
        hero_tag = f"{GREEN}{BOLD}[YOU]{RESET} " if is_hero else "      "

        # Hole cards: hero's are shown; others hidden unless at showdown
        hc = s.get("holeCards") or []
        if hc:
            hc_str = _fmt_cards(hc)
            if is_hero and len(board) >= 3:
                label = _made_hand_label(hc, board)
                hc_str = f"{hc_str}  {DIM}→{RESET} {BOLD}{label}{RESET}"
        else:
            hc_str = f"{DIM}[??][??]{RESET}"

        out.append(
            f"{prefix}{status_glyph} seat {seat_num} {hero_tag}{handle:<20}  "
            f"stack {stack:>5}  in_pot {in_pot:>4}  committed {committed:>4}"
        )
        out.append(f"          {hc_str}")

    out.append(f"{BOLD}╚{bar}╝{RESET}")

    # Waiting-on line — or "waiting for next table" if we already acted
    if t.get("weJustActed"):
        out.append(f"  {DIM}Waiting for next table…{RESET}")
    elif acting_seat is not None:
        acting = next((s for s in seats if s.get("seatNumber") == acting_seat), {})
        who = acting.get("agentHandle") or acting.get("agentName") or f"seat {acting_seat}"
        marker = f"{GREEN}{BOLD}(that's YOU){RESET}" if acting_seat == self_seat else ""
        out.append(f"  {BOLD}Waiting on:{RESET} {YELLOW}{who}{RESET} {marker}")
        if acting_seat == self_seat:
            out.append(f"  Legal: {','.join(allowed)}")


def _find_latest_log() -> Path | None:
    files = sorted(
        glob.glob(str(ROOT / "logs/events-*.jsonl")),
        key=lambda p: os.stat(p).st_mtime,
        reverse=True,
    )
    return Path(files[0]) if files else None


def _color_for_delta(d: int) -> str:
    if d > 0:
        return GREEN
    if d < 0:
        return RED
    return DIM


def _render(
    standings: dict, recent: list[dict], layer_counts: dict, last_actions: list[dict],
    log_path: Path | None, last_pull_ts: float, current_table: dict,
    last_error: str | None = None,
    lobby: dict | None = None,
) -> None:
    out: list[str] = [CLEAR]
    out.append(f"{BOLD}===== Texas Beat 'Em — Live ====={RESET}")

    if standings:
        score = standings.get("totalScore", "?")
        rank = standings.get("rank", "?")
        best = standings.get("bestRank", "?")
        hands = standings.get("totalSubmissions", "?")
        score_color = GREEN if isinstance(score, (int, float)) and score >= 1000 else (
            RED if isinstance(score, (int, float)) and score < 900 else YELLOW
        )
        out.append(
            f"  chips: {score_color}{score}{RESET}    "
            f"rank: {CYAN}{rank}{RESET}  (best {best})    "
            f"hands: {hands}"
        )
    else:
        out.append(f"  {DIM}(waiting for API…){RESET}")

    # Lobby queue position (only meaningful when not at a table)
    if lobby:
        pos = lobby.get("position")
        total = lobby.get("total")
        joined_ms = lobby.get("joinedAt")
        wait_str = ""
        if joined_ms:
            wait_min = (time.time() - joined_ms / 1000) / 60
            wait_str = f", waiting {wait_min:.1f} min"
        out.append(
            f"  {DIM}lobby queue:{RESET} {YELLOW}#{pos}{RESET}{DIM} of {total}{wait_str}{RESET}"
        )

    # Current table view — board + seats + waiting-on
    out.append("")
    if current_table:
        _render_table(out, current_table)
    else:
        if lobby and lobby.get("position"):
            out.append(
                f"{BOLD}Table:{RESET} {DIM}none — queued in lobby "
                f"(#{lobby.get('position')}/{lobby.get('total')}){RESET}"
            )
        else:
            out.append(f"{BOLD}Table:{RESET} {DIM}(waiting…){RESET}")

    out.append("")
    out.append(f"{BOLD}Layer mix this watcher session:{RESET}")
    total = sum(layer_counts.values()) or 1
    for layer in ("L1", "L2", "safe"):
        n = layer_counts.get(layer, 0)
        pct = n / total * 100
        bar = "█" * int(pct / 5)
        out.append(f"  {layer:>4}: {n:>4} ({pct:>4.0f}%) {bar}")

    out.append("")
    out.append(f"{BOLD}Last 8 hands (newest first):{RESET}")
    if recent:
        for r in recent[:8]:
            d = r.get("chipDelta", 0)
            winner = r.get("winnerHandle", "?")
            url = r.get("replayUrl") or ""
            out.append(f"  {_color_for_delta(d)}{d:+5d}{RESET}  vs winner={winner}")
            if url:
                out.append(f"        {DIM}{url}{RESET}")
        net = sum(r.get("chipDelta", 0) for r in recent[:8])
        out.append(f"  {DIM}--- net last 8: {_color_for_delta(net)}{net:+d}{RESET}{DIM} ---{RESET}")
    else:
        out.append(f"  {DIM}(none yet){RESET}")

    out.append("")
    out.append(f"{BOLD}Last 6 decisions (live from JSONL):{RESET}")
    if last_actions:
        for a in last_actions[-6:]:
            layer_color = {"L1": GREEN, "L2": YELLOW, "safe": RED}.get(a["layer"], "")
            amt = f" {a['amount']}" if a.get("amount") is not None else ""
            reasoning = (a.get("reasoning") or "")[:70]
            out.append(
                f"  {layer_color}[{a['layer']:>4}]{RESET} {a['action']:<6}{amt:>5}  "
                f"{DIM}{reasoning}{RESET}"
            )
    else:
        out.append(f"  {DIM}(waiting for events…){RESET}")

    out.append("")
    age = int(time.time() - last_pull_ts)
    age_color = GREEN if age < 15 else (YELLOW if age < 60 else RED)
    log_name = log_path.name if log_path else "(no local log)"
    out.append(f"  {DIM}log: {log_name}    "
               f"API last pulled {age_color}{age}s ago{RESET}")
    if last_error:
        out.append(f"  {RED}API error: {last_error}{RESET}")
    out.append(f"  {DIM}Ctrl-C to exit (does NOT stop the agent){RESET}")

    sys.stdout.write("\n".join(out) + "\n")
    sys.stdout.flush()


async def _fetch_me(client: httpx.AsyncClient, standings: dict, state: dict) -> None:
    try:
        r = await client.get("/api/arena/agent/me", timeout=5.0)
        r.raise_for_status()
        me = r.json()
        for lb in me.get("leaderboard", []):
            if "Playground" in lb.get("arenaName", ""):
                standings.clear()
                standings.update(lb)
        state["last_pull_ts"] = time.time()
        state["err_me"] = None
    except Exception as e:
        state["err_me"] = f"{type(e).__name__}: {str(e)[:60]}"


async def _fetch_lobby(client: httpx.AsyncClient, comp_id: str, state: dict) -> None:
    try:
        r = await client.get(
            "/api/arena/texas/lobby", params={"competitionId": comp_id}, timeout=5.0
        )
        r.raise_for_status()
        state["lobby"] = r.json().get("lobby") or {}
        state["err_lobby"] = None
    except Exception as e:
        state["err_lobby"] = f"{type(e).__name__}: {str(e)[:60]}"


async def _fetch_replays(
    client: httpx.AsyncClient, agent_id: str, recent: list[dict], state: dict,
) -> None:
    try:
        r = await client.get(
            f"/api/arena/agent/{agent_id}/replays", params={"limit": 10}, timeout=8.0
        )
        r.raise_for_status()
        recent.clear()
        recent.extend(r.json())
        state["err_replays"] = None
    except Exception as e:
        state["err_replays"] = f"{type(e).__name__}: {str(e)[:60]}"


async def _api_loop(
    client: httpx.AsyncClient, agent_id: str, comp_id: str,
    standings: dict, recent: list[dict], state: dict,
) -> None:
    """Pull each endpoint independently so one slow one doesn't stall the others."""
    while True:
        # /me + /lobby in parallel — both small, fast endpoints.
        await asyncio.gather(
            _fetch_me(client, standings, state),
            _fetch_lobby(client, comp_id, state),
            return_exceptions=True,
        )
        # /replays is sometimes slow (arena-side). Fire it but don't let it
        # block the next /me cycle — kick it off and continue.
        asyncio.create_task(_fetch_replays(client, agent_id, recent, state))
        # Roll up errors for display.
        errs = [
            f"me:{state['err_me']}" if state.get("err_me") else None,
            f"lobby:{state['err_lobby']}" if state.get("err_lobby") else None,
            f"replays:{state['err_replays']}" if state.get("err_replays") else None,
        ]
        state["last_error"] = " | ".join(x for x in errs if x) or None
        await asyncio.sleep(API_REFRESH)


async def _tail_loop(
    layer_counts: dict, last_actions: list[dict], state: dict, current_table: dict,
) -> None:
    log_path = _find_latest_log()
    file_pos = log_path.stat().st_size if log_path else 0
    state["log_path"] = log_path
    while True:
        # If a new log file is newer than the tracked one, switch to it.
        newest = _find_latest_log()
        if newest and (log_path is None or newest != log_path):
            log_path = newest
            file_pos = 0
            state["log_path"] = log_path
        if log_path is None:
            await asyncio.sleep(1.0)
            continue
        try:
            sz = log_path.stat().st_size
            if sz > file_pos:
                with log_path.open() as f:
                    f.seek(file_pos)
                    chunk = f.read()
                    file_pos = sz
                for line in chunk.splitlines():
                    if not line.strip():
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    kind = e.get("kind")
                    if kind == "table_snapshot":
                        # Fresh snapshot — overwrite the current-table view
                        current_table.clear()
                        current_table.update({
                            "tableId": e.get("tableId"),
                            "street": e.get("street"),
                            "pot": e.get("pot"),
                            "currentBet": e.get("currentBet"),
                            "board": e.get("board") or [],
                            "hole": e.get("hole") or [],
                            "selfSeat": e.get("selfSeat"),
                            "actingSeat": e.get("actingSeat"),
                            "allowed": e.get("allowed") or [],
                            "blinds": e.get("blinds") or {},
                            "seats": e.get("seats") or [],
                            "recentActions": e.get("recentActions") or [],
                        })
                    elif kind == "action_submitted":
                        d = e.get("decision", {})
                        layer = d.get("layer") or "?"
                        layer_counts[layer] = layer_counts.get(layer, 0) + 1
                        last_actions.append({
                            "ts": e.get("ts"),
                            "layer": layer,
                            "action": d.get("action"),
                            "amount": d.get("amount"),
                            "reasoning": d.get("reasoning", ""),
                        })
                        if len(last_actions) > 20:
                            del last_actions[:-20]
                        # If this is the table currently displayed, append our
                        # action to its history and clear the "you're up" state.
                        if (e.get("tableId")
                                and e.get("tableId") == current_table.get("tableId")):
                            ra = current_table.setdefault("recentActions", [])
                            ra.append({
                                "seatNumber": current_table.get("selfSeat"),
                                "action": d.get("action"),
                                "amount": d.get("amount"),
                                "toAmount": d.get("amount"),
                                "street": current_table.get("street"),
                            })
                            current_table["actingSeat"] = None
                            current_table["weJustActed"] = d.get("action")
                            current_table["weJustActedAmount"] = d.get("amount")
        except Exception:
            pass
        await asyncio.sleep(0.5)


async def main() -> int:
    settings = Settings()
    creds = load_credentials()
    if not creds:
        print("ERROR: .arena-credentials not found")
        return 1

    standings: dict = {}
    recent: list[dict] = []
    layer_counts: dict[str, int] = {"L1": 0, "L2": 0, "safe": 0}
    last_actions: list[dict] = []
    current_table: dict = {}
    state: dict[str, Any] = {"last_pull_ts": time.time(), "log_path": None}

    # Switch into the alternate screen buffer so updates don't pollute the
    # terminal scrollback. On exit we restore the original buffer.
    sys.stdout.write(ENTER_ALT + HIDE_CURSOR)
    sys.stdout.flush()

    comp_id = settings.competition_id or os.environ.get("COMPETITION_ID", "")

    async with httpx.AsyncClient(
        base_url=settings.arena_base_url, timeout=10.0,
        headers={"x-arena-api-key": creds["apiKey"]},
    ) as client:
        tasks = [
            asyncio.create_task(
                _api_loop(client, creds["agentId"], comp_id, standings, recent, state)
            ),
            asyncio.create_task(_tail_loop(layer_counts, last_actions, state, current_table)),
        ]
        try:
            while True:
                _render(
                    standings, recent, layer_counts, last_actions,
                    state.get("log_path"), state["last_pull_ts"], current_table,
                    state.get("last_error"),
                    state.get("lobby"),
                )
                await asyncio.sleep(RENDER_REFRESH)
        finally:
            for t in tasks:
                t.cancel()
            # Restore the original terminal buffer + cursor.
            sys.stdout.write(SHOW_CURSOR + EXIT_ALT)
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        # Belt-and-braces: even if asyncio's finally didn't fire (rare), make
        # sure we leave the terminal in a usable state.
        sys.stdout.write(SHOW_CURSOR + EXIT_ALT)
        sys.stdout.flush()
        print("bye")
