"""Deterministic computational tools used by the L2 LLM layer.

Functions here are pure, fast, and produce numeric estimates that the LLM
consumes via the prompt (precomputed) or via tool-calls (future). Keeping
them out of the LLM loop saves latency and cost — and the math is more
trustworthy than letting the model approximate it.
"""

from .equity import equity_vs_random

__all__ = ["equity_vs_random"]
