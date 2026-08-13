"""LLM proxy request parsing (entities.md §9).

The one pure function that reads the caller's request for routing, and nothing else — the
body itself is never re-serialized so the relay stays byte for byte (§7.1).
"""

import json
from typing import Any, Dict

from oss.src.core.gateways.llms.dtos import LlmCallContext


def parse_llm_call_context(*, body: bytes) -> LlmCallContext:
    """Extract model and stream from the JSON body without materializing a
    parsed copy for relay — the body itself stays byte-for-byte (§7.1).
    Raises ValueError when the body names no model; the proxy translates that
    into the surface's own invalid-request error shape."""

    payload: Dict[str, Any] = json.loads(body) if body else {}

    model = payload.get("model") if isinstance(payload, dict) else None
    if not model or not isinstance(model, str):
        raise ValueError("request body names no model")

    stream = bool(payload.get("stream", False)) if isinstance(payload, dict) else False

    return LlmCallContext(model=model, stream=stream)
