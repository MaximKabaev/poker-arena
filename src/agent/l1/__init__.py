"""L1 heuristic decision layer.

Cheap, deterministic, ~200ms budget. Handles the ~70-80% of spots that
don't need LLM reasoning: preflop chart lookups and postflop pot-odds /
made-hand rules. Returns None when the spot is ambiguous — caller should
escalate to L2 or fall through to safe-default.
"""

from .entry import l1_decide

__all__ = ["l1_decide"]
