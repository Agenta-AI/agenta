"""SSE framing for the Vercel AI SDK UI Message Stream."""

from __future__ import annotations

import asyncio
import os
from json import dumps
from typing import Any, AsyncGenerator

# Headers the Vercel AI SDK client and intermediaries require for a UI Message Stream.
# ``x-accel-buffering: no`` stops a proxy from re-buffering the SSE so parts flush live.
VERCEL_UI_MESSAGE_STREAM_HEADERS = {
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
}

# An SSE comment line (starts with ``:``) — the client and the AI SDK ignore it, but a byte on
# the wire keeps proxies/load-balancers from idle-killing a slow-but-alive run mid-completion.
_KEEPALIVE_FRAME = ": keepalive\n\n"


# Seconds of silence before a keepalive comment is sent; resets on every real data frame. Wide
# default (well under a typical 30–60s proxy idle cutoff), env-overridable. ``0`` disables it.
def _keepalive_interval_seconds() -> float:
    try:
        value = float(os.getenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", "15"))
    except ValueError:
        return 15.0
    return value if value > 0 else 0.0


_KEEPALIVE_INTERVAL_SECONDS = _keepalive_interval_seconds()


def vercel_sse_stream(aiter: AsyncGenerator[Any, None]):
    """Frame Vercel UI Message Stream parts as SSE and append ``[DONE]``.

    During a silent gap between parts (e.g. a tool call running for minutes) a keepalive comment
    is emitted on a periodic tick, so a proxy does not idle-kill a run that is still completing
    (and still billing) server-side. The comment lines are inert — data frames are unchanged.
    """
    interval = _KEEPALIVE_INTERVAL_SECONDS

    async def gen():
        if interval <= 0:
            async for chunk in aiter:
                yield "data: " + dumps(chunk, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"
            return

        # Drive the iterator by hand so each pull can race a keepalive tick: on a silent gap the
        # pull times out, we emit a comment, and re-await the SAME pending pull (never dropping or
        # reordering a real part).
        iterator = aiter.__aiter__()
        pending: asyncio.Task | None = None
        try:
            while True:
                if pending is None:
                    pending = asyncio.ensure_future(iterator.__anext__())
                try:
                    chunk = await asyncio.wait_for(
                        asyncio.shield(pending), timeout=interval
                    )
                except asyncio.TimeoutError:
                    # Still waiting on the same part — keep the connection warm and retry.
                    yield _KEEPALIVE_FRAME
                    continue
                except StopAsyncIteration:
                    break
                pending = None
                yield "data: " + dumps(chunk, ensure_ascii=False) + "\n\n"
        finally:
            if pending is not None:
                pending.cancel()
        yield "data: [DONE]\n\n"

    return gen()
