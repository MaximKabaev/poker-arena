"""Per-opponent pattern detection — exploit registry.

When an opponent has played enough hands AND deviates strongly from baseline
in a specific spot type, register an "active exploit". L1 looks up active
exploits before falling back to static charts; if found and confidence is
high, the exploit overrides the chart decision.

Patterns decay: counter-evidence breaks the pattern → exploit deactivates
→ L1 falls back to charts until the pattern re-emerges.

Phase 1 ships one pattern (fold-to-3bet) end-to-end. Pattern set grows
in later iterations.
"""

from .detector import detect_patterns
from .observer import HandObserver
from .registry import PatternRegistry
from .spots import SpotType, classify_action, current_spot

__all__ = [
    "HandObserver",
    "PatternRegistry",
    "SpotType",
    "classify_action",
    "current_spot",
    "detect_patterns",
]
