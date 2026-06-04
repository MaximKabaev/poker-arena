"""List the OpenAI models your API key has access to.

Run from project root:
    uv run python tools/list_models.py
    uv run python tools/list_models.py --filter gpt-5

Prints models grouped, with a recommended pick for `LLM_MODEL` in .env.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from openai import OpenAI  # noqa: E402

from agent.config import Settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--filter", default="", help="substring filter (e.g. gpt-5)")
    args = parser.parse_args()

    settings = Settings()
    if not settings.openai_api_key:
        print("ERROR: OPENAI_API_KEY not set in .env")
        return 1

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        models = client.models.list()
    except Exception as e:
        print(f"ERROR listing models: {e}")
        return 2

    ids = sorted(m.id for m in models.data)
    if args.filter:
        ids = [m for m in ids if args.filter.lower() in m.lower()]

    if not ids:
        print(f"no models matched filter={args.filter!r}")
        return 3

    # Group by family
    groups: dict[str, list[str]] = {}
    for m in ids:
        if m.startswith("gpt-5"):
            groups.setdefault("gpt-5 family", []).append(m)
        elif m.startswith("gpt-4"):
            groups.setdefault("gpt-4 family", []).append(m)
        elif m.startswith("o"):
            groups.setdefault("o-series (reasoning)", []).append(m)
        else:
            groups.setdefault("other", []).append(m)

    for name, mods in groups.items():
        print(f"\n== {name} ({len(mods)}) ==")
        for m in mods:
            print(f"  {m}")

    # Pick the best for poker reasoning. Preference: newest gpt-5 > o-series > gpt-4
    pick = None
    for prefix in ("gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5", "o3", "o1", "gpt-4o", "gpt-4"):
        candidates = [m for m in ids if m.startswith(prefix)]
        # Prefer the non-dated short alias if present (e.g. "gpt-5.3" over "gpt-5.3-2026-..")
        candidates.sort(key=lambda s: (len(s), s))
        if candidates:
            pick = candidates[0]
            break

    print("\n" + "=" * 60)
    if pick:
        print(f"Recommended for LLM_MODEL: {pick}")
        print(f"\nSet in .env:\n  LLM_MODEL={pick}")
    else:
        print("No recommended model found in your available list.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
