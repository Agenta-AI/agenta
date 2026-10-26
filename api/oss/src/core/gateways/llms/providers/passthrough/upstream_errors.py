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
    google_error,
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
        if protocol == LLMProtocol.GEMINI:
            # Rebuilt whole in Google's shape: Vertex's own fields name the project.
            payload = google_error(
                status=status,
                message=upstream_error_message(
                    code=code, provider_message=said, built_in=not quote_upstream
                ),
            )
            if scanner.detects(_dumps(payload)):
                raise echo_refusal
            return payload
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
            code=code, provider_message=said, built_in=not quote_upstream
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

    # The platform's own upstream is trusted with memory, and an oversized event of its own may
    # be an error that names its cloud project, so it is never relayed unread.
    relay = _SseRelay(
        lambda data: marked(data, None),
        relay_oversized=quote_upstream,
        finished=_gemini_finished
        if protocol == LLMProtocol.GEMINI
        else _marker_finished,
    )
    try:
        async for chunk in body:
            if relayed := relay.feed(chunk):
                yield relayed
        if protocol == LLMProtocol.GEMINI and relay.holds_partial_event():
            # The upstream closed inside an event. Google's client fails on the half event
            # ("Incomplete JSON segment") with words Pi does not retry, so the half event is
            # dropped and the caller gets the error event a broken connection gets.
            relay.drop()
            if not relay.finished:
                yield _connection_lost_event(protocol)
            return
        if relayed := relay.flush():
            yield relayed
    except httpx.TransportError:
        # The upstream broke off after it started answering. The half event it was in the
        # middle of is dropped, and the caller gets one error event instead.
        if not relay.finished:
            yield _connection_lost_event(protocol)


def _connection_lost_event(protocol: LLMProtocol) -> bytes:
    """The one error event a stream that broke off before its end closes with."""
    if protocol == LLMProtocol.GEMINI:
        error = google_error(status=None, message=connection_lost_message())
    else:
        error = _error_payload(protocol, code=UPSTREAM_ERROR, event=True)
        _error_holder(error)["message"] = connection_lost_message()
    name = (
        b""
        if protocol in (LLMProtocol.CHAT_COMPLETIONS, LLMProtocol.GEMINI)
        else b"event: error\n"
    )
    return name + b"data: " + _dumps(error) + b"\n\n"


class _SseRelay:
    """Relay a stream event by event, rewriting only an error event.

    Only an unfinished event is held (a client cannot act on it before its blank line), so a
    stream that breaks off mid-event can still end with an error that parses.
    """

    def __init__(
        self,
        mark: Callable[[Any], Dict[str, Any]],
        *,
        relay_oversized: bool = True,
        finished: Optional[Callable[[bytes], bool]] = None,
    ) -> None:
        self._mark = mark
        self._relay_oversized = relay_oversized
        self._finished = finished or _marker_finished
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
        if self._relay_oversized and len(self._buffer) > _MAX_EVENT_BYTES:
            out.append(self._buffer)
            self._buffer = b""
        return b"".join(out)

    def flush(self) -> bytes:
        rest, self._buffer = self._buffer, b""
        return self._event(rest) if rest else b""

    def holds_partial_event(self) -> bool:
        """Whether the held bytes are an event cut short: some text, but no data that parses."""
        if not self._buffer.strip():
            return False
        return not isinstance(_event_data(self._buffer), (dict, list))

    def drop(self) -> None:
        self._buffer = b""

    def _event(self, event: bytes) -> bytes:
        self.finished = self.finished or self._finished(event)
        if b"error" not in event:
            return event
        data = _event_data(event)
        if _error_holder(data) is None:
            return event
        self.finished = True
        return _with_data(event, self._mark(data))


def _marker_finished(event: bytes) -> bool:
    """Whether an event ends its stream. Token deltas are the bulk of a stream: they are
    matched as bytes, never parsed."""
    return any(marker in event for marker in _TERMINAL_MARKERS)


def _gemini_finished(event: bytes) -> bool:
    """Whether a native Gemini event ends its stream: it has no `[DONE]`, and its last event
    names a `finishReason`. Only an event that mentions one is parsed."""
    if b"finishReason" not in event:
        return False
    data = _event_data(event)
    candidates = data.get("candidates") if isinstance(data, dict) else None
    first = candidates[0] if isinstance(candidates, list) and candidates else None
    return isinstance(first, dict) and bool(first.get("finishReason"))


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
