"""SSE framing for the Vercel AI SDK UI Message Stream."""

from __future__ import annotations

from json import dumps
from typing import Any, AsyncGenerator

# Headers the Vercel AI SDK client and intermediaries require for a UI Message Stream.
# ``x-accel-buffering: no`` stops a proxy from re-buffering the SSE so parts flush live.
VERCEL_UI_MESSAGE_STREAM_HEADERS = {
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
}


def vercel_sse_stream(aiter: AsyncGenerator[Any, None]):
    """Frame Vercel UI Message Stream parts as SSE and append ``[DONE]``."""

    async def gen():
        async for chunk in aiter:
            yield "data: " + dumps(chunk, ensure_ascii=False) + "\n\n"
        yield "data: [DONE]\n\n"

    return gen()
