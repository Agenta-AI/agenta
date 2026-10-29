"""Cleanup that still runs when the surrounding task is cancelled (OR48).

A gateway call ends in a `finally` that awaits: the streaming drain records the call, and
the relay adapter closes the upstream response. Starlette cancels the task scope the moment
the client disconnects, and an `await` inside a `finally` in a cancelled scope raises
straight away, so neither ran: an aborted stream was never metered and its upstream
connection was left open until the pool timed it out.
"""

import asyncio
from typing import Any, Awaitable, Set

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# A shielded cleanup runs as a task of its own, and between two of its steps the event loop
# is the only thing referencing it — a reference the loop drops while the task waits. These
# entries keep it alive until it is done.
_PENDING: Set["asyncio.Task[Any]"] = set()


def _forget(task: "asyncio.Task[Any]") -> None:
    _PENDING.discard(task)


def _log_failure(task: "asyncio.Task[Any]") -> None:
    """Read the result of a cleanup nobody is left to await."""
    _PENDING.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        log.warning("[gateways] cleanup failed after cancellation", exc_info=error)


async def run_shielded(awaitable: Awaitable[Any]) -> None:
    """Await `awaitable` so that a cancellation of the caller cannot stop it.

    `asyncio.shield` runs the cleanup as its own task, which no cancellation of the calling
    task reaches. A caller that finishes normally sees no change at all: the shield's await
    returns when the cleanup returns, in the same order, and a cleanup that raises still
    raises into the caller. A caller being cancelled gets its `CancelledError` back out of
    the shield — cancellation is re-raised, never swallowed — while the cleanup carries on
    to completion on the loop. Nothing waits on it there, so the abort is not held open for
    the cleanup's sake, and its outcome is collected by the callback rather than surfacing
    as a lost exception.
    """
    task = asyncio.ensure_future(awaitable)
    _PENDING.add(task)
    cancelled = False
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        cancelled = True
        raise
    finally:
        # Only the cancelled path leaves the cleanup unattended, so only that path needs a
        # callback that reads its exception; otherwise the failure already reached here.
        task.add_done_callback(_log_failure if cancelled else _forget)
