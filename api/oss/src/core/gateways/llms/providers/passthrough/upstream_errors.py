"""Rewrite an upstream error's `message` as the relay passes it, keeping the protocol's shape.

Covers an error status's body, an error event in a stream, and a stream that breaks off.
Every other byte is relayed as the upstream sent it.
"""

import json
import re
from typing import Any, AsyncIterator, Callable, Dict, Optional

import httpx

from oss.src.core.gateways.dtos import CredentialEchoScanner
from oss.src.core.gateways.llms.dtos import LLMProtocol
from oss.src.core.gateways.llms.errors import (
    UPSTREAM_ERROR,
    classify_upstream_error,
    connection_lost_message,
    upstream_error_message,
)

_EVENT_END = re.compile(rb"\r\n\r\n|\n\n|\r\r")
_LINE_END = re.compile(rb"\r\n|\r|\n")

# The usage reader's bound: an event longer than this is relayed as it stands.
_MAX_EVENT_BYTES = 1_048_576

# An error's fields that name no account, kept when the upstream's words are not quoted.
_KEPT_WHEN_UNQUOTED = frozenset({"type", "code", "param"})

# Events after which the upstream has nothing more to say, so a broken connection is not news.
_TERMINAL_MARKERS = (
    b"data: [DONE]",
    b"data:[DONE]",
    b'"response.completed"',
    b'"response.incomplete"',
    b'"message_stop"',
)


async def relay_upstream_errors(
    body: AsyncIterator[bytes],
    *,
    status_code: int,
    stream: bool,
    protocol: LLMProtocol,
    label: Optional[str],
    scanner: CredentialEchoScanner,
    echo_refusal: Exception,
    quote_upstream: bool = True,
) -> AsyncIterator[bytes]:
    def marked(
        payload: Any, status: Optional[int], said: Optional[str] = None
    ) -> Dict[str, Any]:
        """The upstream's error with its message rewritten; every other field kept."""
        holder = _error_holder(payload)
        if holder is not None:
            said = holder.get("message")
        code = classify_upstream_error(
            status=status,
            code=(holder.get("code") or holder.get("type")) if holder else None,
            message=said,
        )
        if holder is None:
            payload = _error_payload(protocol, code=code, event=False)
            holder = _error_holder(payload)
        if not quote_upstream:
            # Vertex AI puts the project and region in fields like `status` and `details`, so
            # the error is rebuilt in the protocol's own shape around the fields kept.
            kept = {k: v for k, v in (holder or {}).items() if k in _KEPT_WHEN_UNQUOTED}
            payload = _error_payload(protocol, code=code, event=status is None)
            holder = _error_holder(payload)
            if holder is payload:
                # A Responses `error` event: its `type` names the event.
                kept.pop("type", None)
            holder.update(kept)
        holder["message"] = upstream_error_message(
            label=label, code=code, provider_message=said if quote_upstream else None
        )
        # The raw bytes were scanned already; decoded JSON can still hold an escaped key.
        if scanner.detects(_dumps(payload)):
            raise echo_refusal
        return payload

    if status_code >= 400:
        # Bounded like a stream event: only 300 characters of it are ever quoted.
        parts, size = [], 0
        async for chunk in body:
            parts.append(chunk)
            size += len(chunk)
            if size > _MAX_EVENT_BYTES:
                await body.aclose()
                break
        content = b"".join(parts)[:_MAX_EVENT_BYTES]
        try:
            payload = json.loads(content)
        except ValueError:
            payload = None
        # Gemini wraps its error in a list.
        if isinstance(payload, list) and payload:
            payload = payload[0]
        yield _dumps(marked(payload, status_code, _loose_message(payload, content)))
        return

    if not stream:
        async for chunk in body:
            yield chunk
        return

    relay = _SseRelay(lambda data: marked(data, None))
    try:
        async for chunk in body:
            if relayed := relay.feed(chunk):
                yield relayed
        if relayed := relay.flush():
            yield relayed
    except httpx.TransportError:
        # The upstream broke off after it started answering. The half event it was in the
        # middle of is dropped, and the caller learns which endpoint failed.
        if not relay.finished:
            error = _error_payload(protocol, code=UPSTREAM_ERROR, event=True)
            _error_holder(error)["message"] = connection_lost_message(label=label)
            name = (
                b"" if protocol == LLMProtocol.CHAT_COMPLETIONS else b"event: error\n"
            )
            yield name + b"data: " + _dumps(error) + b"\n\n"


class _SseRelay:
    """Relay a stream event by event, rewriting only an error event.

    Only an unfinished event is held (a client cannot act on it before its blank line), so a
    stream that breaks off mid-event can still end with an error that parses.
    """

    def __init__(self, mark: Callable[[Any], Dict[str, Any]]) -> None:
        self._mark = mark
        self._buffer = b""
        self.finished = False

    def feed(self, chunk: bytes) -> bytes:
        # A boundary can only end in the new bytes, or start up to 3 bytes before them.
        start = max(len(self._buffer) - 3, 0)
        self._buffer += chunk
        out = []
        while end := _EVENT_END.search(self._buffer, start):
            start = 0
            event, self._buffer = self._buffer[: end.end()], self._buffer[end.end() :]
            out.append(self._event(event))
        if len(self._buffer) > _MAX_EVENT_BYTES:
            out.append(self._buffer)
            self._buffer = b""
        return b"".join(out)

    def flush(self) -> bytes:
        rest, self._buffer = self._buffer, b""
        return self._event(rest) if rest else b""

    def _event(self, event: bytes) -> bytes:
        # Token deltas are the bulk of a stream: they are matched as bytes, never parsed.
        self.finished = self.finished or any(
            marker in event for marker in _TERMINAL_MARKERS
        )
        if b"error" not in event:
            return event
        data = _event_data(event)
        if _error_holder(data) is None:
            return event
        self.finished = True
        return _with_data(event, self._mark(data))


def _event_data(event: bytes) -> Any:
    """What an event's `data:` lines carry: parsed JSON, else the text, else None."""
    lines = [line[5:] for line in _LINE_END.split(event) if line.startswith(b"data:")]
    if not lines:
        return None
    data = b"\n".join(line[1:] if line.startswith(b" ") else line for line in lines)
    try:
        return json.loads(data)
    except ValueError:
        return data.decode(errors="replace")


def _with_data(event: bytes, payload: Any) -> bytes:
    """The event with its `data:` lines replaced by one line carrying `payload`."""
    kept = [
        line
        for line in _LINE_END.split(event)
        if line and not line.startswith(b"data:")
    ]
    return b"\n".join(kept + [b"data: " + _dumps(payload)]) + b"\n\n"


def _dumps(payload: Any) -> bytes:
    # Unescaped, so the code marker reads the same in a harness that keeps the raw text.
    return json.dumps(payload, ensure_ascii=False).encode()


def _loose_message(payload: Any, content: bytes) -> Optional[str]:
    """An error body's text outside the protocol's shape (vLLM, Ollama, FastAPI, plain text)."""
    if isinstance(payload, dict):
        for key in ("error", "message", "detail"):
            if isinstance(payload.get(key), str):
                return payload[key]
        return None
    text = content.decode(errors="replace").strip()
    # Never quote an HTML page.
    return text if payload is None and not text.startswith("<") else None


def _error_holder(payload: Any) -> Optional[Dict[str, Any]]:
    """The object carrying an error's `message`, in any of the three protocols, or None.

    Chat Completions and Messages nest it under `error`; a Responses `error` event carries
    it at the top level, and `response.failed` under `response.error`.
    """
    if not isinstance(payload, dict):
        return None
    if payload.get("type") == "response.failed":
        response = payload.get("response")
        error = response.get("error") if isinstance(response, dict) else None
        return error if isinstance(error, dict) else None
    error = payload.get("error")
    if isinstance(error, dict):
        return error
    return payload if payload.get("type") == "error" else None


def _error_payload(protocol: LLMProtocol, *, code: str, event: bool) -> Dict[str, Any]:
    """An error in the protocol's own shape, for a failure that brought none of its own."""
    if protocol == LLMProtocol.MESSAGES:
        return {"type": "error", "error": {"type": "api_error"}}
    if protocol == LLMProtocol.RESPONSES and event:
        return {"type": "error", "code": code, "param": None}
    return {"error": {"type": "api_error", "code": code}}
