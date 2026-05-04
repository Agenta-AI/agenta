"""Clock abstraction.

Why this is a dependency: every test that touches cancellation timing,
modification windows, or "is the stay current" reasoning runs against a
``FixedClock``. Production wires a ``SystemClock``.

The clock lives in ``AgentDeps`` because the agent itself reads "now" when
reasoning about policy — the system prompt typically injects "Today is
YYYY-MM-DD" from this same source.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    """Wraps ``datetime.now(timezone.utc)``. Production default."""

    def now(self) -> datetime:
        return datetime.now(timezone.utc).replace(tzinfo=None)


class FixedClock:
    """Returns a constant time. For tests."""

    def __init__(self, when: datetime):
        self._when = when

    def now(self) -> datetime:
        return self._when

    def set(self, when: datetime) -> None:
        """Useful for multi-step tests that simulate the clock advancing."""
        self._when = when
