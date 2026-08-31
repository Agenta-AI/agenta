"""Extract LLM routing fields without modifying the relayed body."""

import json
from typing import Any, Dict

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol


def _parse(*, body: bytes, protocol: LLMProtocol) -> LLMCallContext:
    payload: Dict[str, Any] = json.loads(body) if body else {}

    model = payload.get("model") if isinstance(payload, dict) else None
    if not model or not isinstance(model, str):
        raise ValueError("request body names no model")

    stream = payload.get("stream", False) if isinstance(payload, dict) else False
    if not isinstance(stream, bool):
        raise ValueError("request body stream must be a boolean")

    return LLMCallContext(model=model, stream=stream, protocol=protocol)


def parse_llm_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Chat Completions request."""
    return _parse(body=body, protocol=LLMProtocol.CHAT_COMPLETIONS)


def parse_responses_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Responses request."""
    return _parse(body=body, protocol=LLMProtocol.RESPONSES)


def parse_messages_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Messages request."""
    return _parse(body=body, protocol=LLMProtocol.MESSAGES)
