"""LLM proxy request parsing (entities.md §9, D33 WP23).

One pure function per front door that reads the caller's request for routing, and
nothing else — the body itself is never re-serialized so the relay stays byte for byte
(§7.1). `model` and `stream` share field names across Chat Completions, Responses and
Messages, so the three parsers below differ only in the `LLMCallContext.protocol` they
stamp — three small functions per D33's "one door, one parser", not one generic function
branching on a protocol argument.
"""

import json
from typing import Any, Dict

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol


def _parse(*, body: bytes, protocol: LLMProtocol) -> LLMCallContext:
    payload: Dict[str, Any] = json.loads(body) if body else {}

    model = payload.get("model") if isinstance(payload, dict) else None
    if not model or not isinstance(model, str):
        raise ValueError("request body names no model")

    stream = bool(payload.get("stream", False)) if isinstance(payload, dict) else False

    return LLMCallContext(model=model, stream=stream, protocol=protocol)


def parse_llm_call_context(*, body: bytes) -> LLMCallContext:
    """Chat Completions (`/v1/chat/completions`). Raises ValueError when the body
    names no model; the proxy translates that into the surface's own
    invalid-request error shape."""
    return _parse(body=body, protocol=LLMProtocol.CHAT_COMPLETIONS)


def parse_responses_call_context(*, body: bytes) -> LLMCallContext:
    """OpenAI Responses (`/v1/responses`). Same `model`/`stream` fields as Chat
    Completions; tagged RESPONSES so the ceiling binds to `max_output_tokens`."""
    return _parse(body=body, protocol=LLMProtocol.RESPONSES)


def parse_messages_call_context(*, body: bytes) -> LLMCallContext:
    """Anthropic Messages (`/v1/messages`). Same `model`/`stream` fields again;
    tagged MESSAGES so the ceiling binds to `max_tokens`."""
    return _parse(body=body, protocol=LLMProtocol.MESSAGES)
