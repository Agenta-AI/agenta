"""Extract LLM routing fields without modifying the relayed body."""

import json
from typing import Any, Dict

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol


class LLMRequestBodyError(ValueError):
    """A request body the gateway cannot route, said in this module's own words.

    A `ValueError` so the proxy's existing arm keeps catching it, and typed so that arm
    can tell a complaint this module authored from any other `ValueError` that reaches
    it. Only the authored ones are shown to a caller: a decoder's own message quotes the
    bytes it choked on, and nothing else that raises here is describing the request.
    """

    def __init__(self, *, cause: str, detail: str) -> None:
        self.cause = cause
        self.detail = detail
        super().__init__(detail)


def _parse(*, body: bytes, protocol: LLMProtocol) -> LLMCallContext:
    try:
        payload: Dict[str, Any] = json.loads(body) if body else {}
    except ValueError as exc:
        # `json.JSONDecodeError` and `UnicodeDecodeError` are both `ValueError`, and both
        # carry the offending bytes or their position in the message. Replaced with a
        # fixed sentence rather than relayed.
        raise LLMRequestBodyError(
            cause="invalid_json", detail="request body is not valid JSON"
        ) from exc

    model = payload.get("model") if isinstance(payload, dict) else None
    if not model or not isinstance(model, str):
        raise LLMRequestBodyError(
            cause="model_missing", detail="request body names no model"
        )

    stream = payload.get("stream", False) if isinstance(payload, dict) else False
    if not isinstance(stream, bool):
        raise LLMRequestBodyError(
            cause="stream_not_a_boolean",
            detail="request body stream must be a boolean",
        )

    return LLMCallContext(model=model, stream=stream, protocol=protocol)


def parse_gemini_call_context(*, body: bytes, model: str) -> LLMCallContext:
    """Check a native Gemini request's body; its model comes from the URL path, named
    `google/<model>` as the built-in endpoint's allowlist spells it."""
    try:
        payload = json.loads(body) if body else None
    except ValueError as exc:
        raise LLMRequestBodyError(
            cause="invalid_json", detail="request body is not valid JSON"
        ) from exc
    if not isinstance(payload, dict):
        raise LLMRequestBodyError(
            cause="not_an_object", detail="request body must be a JSON object"
        )
    return LLMCallContext(
        model=f"google/{model}", stream=True, protocol=LLMProtocol.GEMINI
    )


def parse_llm_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Chat Completions request."""
    return _parse(body=body, protocol=LLMProtocol.CHAT_COMPLETIONS)


def parse_responses_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Responses request."""
    return _parse(body=body, protocol=LLMProtocol.RESPONSES)


def parse_messages_call_context(*, body: bytes) -> LLMCallContext:
    """Parse a Messages request."""
    return _parse(body=body, protocol=LLMProtocol.MESSAGES)
