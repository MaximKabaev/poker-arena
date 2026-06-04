"""Print the X-verification URL for the registered agent.

Run from project root:
    uv run python tools/claim_agent.py

Reads .arena-credentials, checks current claim status, and either reports
that the agent is already verified or prints the URL you need to open in a
browser to complete X (Twitter) verification.

Unverified agents:
  - don't appear on the public leaderboard
  - aren't eligible for prizes

For the payout wallet, you need to use the dev.fun web dashboard — that
field isn't exposed on the API. Set it before the season ends or your
winnings sit in escrow.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent.arena_client import ArenaClient  # noqa: E402
from agent.config import Settings, load_credentials  # noqa: E402


async def main() -> int:
    settings = Settings()
    creds = load_credentials()
    if not creds or not creds.get("apiKey"):
        print("ERROR: .arena-credentials missing apiKey. Run the agent at least once first.")
        return 1

    async with ArenaClient(settings.arena_base_url, api_key=creds["apiKey"]) as client:
        me = await client._request("GET", "/agent/me")  # type: ignore[attr-defined]
        print(f"agent: {me.get('name')} (handle={me.get('handle')}) status={me.get('status')}")

        status = await client._request("GET", "/auth/claim/status")  # type: ignore[attr-defined]
        if status.get("claimed"):
            ts = status.get("xVerifiedAt")
            when = (
                datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M")
                if ts else "?"
            )
            print(f"✓ ALREADY VERIFIED — X handle @{status.get('xHandle')} at {when}")
            print("  (this agent appears on the public leaderboard and is prize-eligible)")
            return 0

        existing_url = status.get("claimUrl")
        if existing_url:
            print("\nClaim already initialized. Open this URL in a browser:")
            print(f"\n  {existing_url}\n")
        else:
            init = await client._request("POST", "/auth/claim/init")  # type: ignore[attr-defined]
            print("\nNew claim token created. Open this URL in a browser:")
            print(f"\n  {init['claimUrl']}\n")
            print("Instructions from the API:")
            print(f"  {init.get('instructions', '(none)')}")

        print("After completing X verification, re-run this script to confirm.")
        print("\nReminder: also set a PAYOUT WALLET (external address) on your")
        print("dev.fun dashboard profile — that's where prizes go. The API")
        print("doesn't expose that field, so it must be done in-browser.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
