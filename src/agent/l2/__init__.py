"""L2 LLM decision layer.

Fires only when L1 escalates (returns None). Calls GPT-5.3 with a rich
single-shot prompt: precomputed equity, opponent stats, table state, style.
Hard 5s budget, falls back to safe-default on timeout or parse failure.
"""

from .entry import l2_decide

__all__ = ["l2_decide"]
