"""Live streaming surface: ``AgentRun`` turns the runner's NDJSON record stream into a live
``AgentEvent`` async-iterable plus the one terminal ``AgentResult``.

A streaming transport (``utils.deliver_*_stream``) yields the runner's ``StreamRecord`` lines:
``{"kind":"event", ...}`` for every event the moment it is built, then exactly one
``{"kind":"result", ...}`` terminal record. ``AgentRun`` wraps that source so a caller can::

    run = session.stream(messages)
    async for event in run:
        ...               # event is an AgentEvent, flushed live
    result = run.result()  # the terminal AgentResult (session_id, usage, stop_reason, ...)

This lives in its own module (not ``dtos``) because parsing the terminal record reuses
``utils.wire.result_from_wire``, which imports the DTOs — keeping ``AgentRun`` above both
avoids an import cycle.
"""

from __future__ import annotations

from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Dict,
    List,
    Optional,
)

from .dtos import AgentEvent, AgentResult
from .utils import result_from_wire

# Hooks: a result hook sees the terminal result once; a cleanup runs when iteration ends
# (drain, break, or cancel).
ResultHook = Callable[[AgentResult], None]
Cleanup = Callable[[], Awaitable[None]]


class AgentRun:
    """An async-iterable over a run's live ``AgentEvent``s that also carries the terminal
    ``AgentResult``.

    Iterate it once. Each ``{"kind":"event"}`` record is yielded as an ``AgentEvent``; the
    ``{"kind":"result"}`` record is parsed (raising the run's error when ``ok`` is false,
    just like the one-shot path) and ends iteration. ``result()`` returns it afterwards.
    """

    def __init__(self, records: AsyncIterator[Dict[str, Any]]) -> None:
        self._records = records
        self._result: Optional[AgentResult] = None
        self._result_hooks: List[ResultHook] = []
        self._cleanups: List[Cleanup] = []

    def on_result(self, hook: ResultHook) -> "AgentRun":
        """Register a callback to run when the terminal result arrives (chainable)."""
        self._result_hooks.append(hook)
        return self

    def on_cleanup(self, cleanup: Cleanup) -> "AgentRun":
        """Register an async cleanup to run when iteration ends, any way it ends (chainable)."""
        self._cleanups.append(cleanup)
        return self

    async def __aiter__(self) -> AsyncIterator[AgentEvent]:
        saw_terminal = False
        try:
            async for record in self._records:
                kind = record.get("kind")
                if kind == "event":
                    event = AgentEvent.from_wire(record.get("event"))
                    if event is not None:
                        yield event
                elif kind == "result":
                    # result_from_wire raises on ok=false — surface it to the consumer.
                    self._result = result_from_wire(record.get("result") or {})
                    for hook in self._result_hooks:
                        hook(self._result)
                    saw_terminal = True
                    return
            if not saw_terminal:
                # A truncated stream (runner disconnect/early exit) would otherwise leave
                # ``result()`` raising an opaque "not available" later; fail loud here instead.
                raise RuntimeError(
                    "AgentRun stream ended without a terminal result record"
                )
        finally:
            for cleanup in self._cleanups:
                try:
                    await cleanup()
                except Exception:  # pylint: disable=broad-except
                    pass

    def result(self) -> AgentResult:
        """The terminal result. Available only after the stream is fully consumed."""
        if self._result is None:
            raise RuntimeError(
                "AgentRun result is not available until the stream is fully consumed"
            )
        return self._result
