"""SSE frame generator for ``GET /sessions/streams/watch`` (M3 live relay).

Bridges one Redis pub/sub subscription (durable plane, one per SSE connection)
into `text/event-stream` frames. Most events carry type plus minimal metadata;
interaction events may carry committed row state so readers can retire a gate
without a query round trip. Idle periods emit ``: heartbeat`` comment frames so
proxies and clients never see a silent connection.
"""

import json
import math
import threading
from typing import Any, AsyncIterator, Callable, Optional

from oss.src.dbs.redis.sessions.contract import (
    WATCH_EVENT_INTERACTION,
    WATCH_EVENT_LIFECYCLE,
    WATCH_EVENT_READY,
    WATCH_EVENT_RECORDS_CHANGED,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

HEARTBEAT_FRAME = ": heartbeat\n\n"

# ---------------------------------------------------------------------------
# Server-shutdown release.
#
# Uvicorn's graceful shutdown drains in-flight responses BEFORE it runs lifespan
# shutdown, and an SSE response never completes on its own — so without a release
# every reload/stop waits on these generators forever (live symptom: the dev
# stack's `uvicorn --reload` logs "Reloading..." and the API stays dead until a
# hard container restart, since any open browser tab holds a watch stream).
# `Server.handle_exit` is the first thing uvicorn does on SIGINT/SIGTERM — before
# the drain — so hooking it (the sse-starlette approach) releases every stream
# within one poll interval and lets the drain complete. A client disconnect
# already releases a stream by cancelling the generator; this covers the server
# side. A `threading.Event` because the hook may run from a signal frame: no
# event-loop affinity, and polling it is cheap.
# ---------------------------------------------------------------------------

_shutdown = threading.Event()

# Upper bound on how long a stream keeps waiting on Redis before it re-checks the
# shutdown flag, so a reload never waits a full heartbeat interval (15s default).
_SHUTDOWN_POLL_SECONDS = 1.0


def request_shutdown() -> None:
    """Release every open watch stream (idempotent; wired into uvicorn's exit path)."""
    _shutdown.set()


def _install_uvicorn_exit_hook() -> None:
    try:
        from uvicorn.server import Server  # noqa: PLC0415 — optional dependency
    except Exception:  # pragma: no cover — no uvicorn (workers, bare test runs)
        return
    if getattr(Server.handle_exit, "_agenta_watch_hook", False):  # pragma: no cover
        return
    original = Server.handle_exit

    def handle_exit(self: Any, sig: Any, frame: Any) -> Any:
        request_shutdown()
        return original(self, sig, frame)

    handle_exit._agenta_watch_hook = True  # type: ignore[attr-defined]
    Server.handle_exit = handle_exit  # type: ignore[method-assign]


_install_uvicorn_exit_hook()


def retry_frame(retry_milliseconds: int) -> str:
    """SSE `retry:` field — sets the client's built-in auto-reconnect delay."""
    return f"retry: {retry_milliseconds}\n\n"


def ready_frame() -> str:
    """Emitted once the Redis subscription is live: the client's cue to revalidate."""
    return "event: " + WATCH_EVENT_READY + "\ndata: {}\n\n"


_KNOWN_EVENTS = {
    WATCH_EVENT_RECORDS_CHANGED,
    WATCH_EVENT_LIFECYCLE,
    WATCH_EVENT_INTERACTION,
    "session-changed",
    "workflow-changed",
}
# Each project event family also needs its view permission in the project route's conjunction.


def format_watch_frame(raw: Any) -> Optional[str]:
    """One published payload -> one SSE frame; None for anything malformed/unknown."""
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    event = payload.get("type")
    # `_KNOWN_EVENTS` is a set, so an unhashable `type` (a list, a dict) would raise
    # TypeError out of the membership test and tear down the whole stream. A malformed
    # publish must drop its own frame, never the connection.
    if not isinstance(event, str) or event not in _KNOWN_EVENTS:
        return None
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


async def watch_event_stream(
    *,
    channel: str,
    pubsub_factory: Callable[[], Any],
    heartbeat_seconds: float,
    retry_milliseconds: int,
) -> AsyncIterator[str]:
    """Subscribe to the session's watch channel and yield SSE frames forever.

    The first frame is a ``retry:`` preamble: it pins the client's built-in
    auto-reconnect delay (implementation-defined otherwise) so a server-side
    drop — an API restart, a deploy — cannot reconnect-storm us.

    The second is a ``ready`` event, and that is what a client revalidates on.
    ``onopen`` fires as soon as the response headers arrive, and Starlette flushes
    those BEFORE it starts iterating this generator — so a revalidation driven by
    ``onopen`` can read the record log, and a change can land and publish, all before
    the ``subscribe`` below completes. That change would reach neither the refetch nor
    the stream. ``ready`` is emitted once the subscription is live, so a revalidation
    keyed on it cannot straddle the gap.

    The subscription is torn down in ``finally`` — a client disconnect cancels
    the generator (GeneratorExit/CancelledError), which is exactly the cleanup
    path, so no Redis subscription outlives its SSE connection. CancelledError is
    never swallowed here: the ``finally`` guards only the best-effort teardown.

    Server shutdown is the OTHER release path: the loop re-checks the module
    shutdown flag at least every ``_SHUTDOWN_POLL_SECONDS``, and returns as soon
    as it is set — uvicorn's drain would otherwise wait on this generator forever
    (see the module comment). The heartbeat cadence is preserved by counting idle
    polls rather than lengthening the wait.
    """
    pubsub = pubsub_factory()
    try:
        await pubsub.subscribe(channel)
        yield retry_frame(retry_milliseconds)
        yield ready_frame()
        poll_seconds = min(heartbeat_seconds, _SHUTDOWN_POLL_SECONDS)
        idle_polls_per_heartbeat = max(1, math.ceil(heartbeat_seconds / poll_seconds))
        idle_polls = 0
        while not _shutdown.is_set():
            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=poll_seconds,
            )
            if _shutdown.is_set():
                break
            if message is None:
                idle_polls += 1
                if idle_polls >= idle_polls_per_heartbeat:
                    idle_polls = 0
                    yield HEARTBEAT_FRAME
                continue
            idle_polls = 0
            if message.get("type") != "message":
                continue
            frame = format_watch_frame(message.get("data"))
            if frame is not None:
                yield frame
    finally:
        # Two independent attempts: a failing unsubscribe must not skip the close, or the
        # connection outlives the disconnected client.
        try:
            await pubsub.unsubscribe(channel)
        except Exception as exc:  # pragma: no cover — teardown is best-effort
            log.warning(
                "[WATCH] pubsub unsubscribe failed",
                channel=channel,
                error=repr(exc),
            )
        try:
            await pubsub.aclose()
        except Exception as exc:  # pragma: no cover — teardown is best-effort
            log.warning(
                "[WATCH] pubsub close failed",
                channel=channel,
                error=repr(exc),
            )
