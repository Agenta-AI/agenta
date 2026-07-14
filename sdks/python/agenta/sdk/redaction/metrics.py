"""In-process ``redactions_total{sink,kind}`` counter.

Evidence that the redaction control operates, never the matched value. A minimal dict-backed
counter is sufficient here; a real metrics backend can read `snapshot()` if needed later.
"""

from __future__ import annotations

from threading import Lock
from typing import Dict, Tuple

_lock = Lock()
_counts: Dict[Tuple[str, str], int] = {}


def increment(sink: str, kind: str) -> None:
    with _lock:
        key = (sink, kind)
        _counts[key] = _counts.get(key, 0) + 1


def snapshot() -> Dict[Tuple[str, str], int]:
    with _lock:
        return dict(_counts)


def reset() -> None:
    """Test-only: clear all counts."""
    with _lock:
        _counts.clear()
