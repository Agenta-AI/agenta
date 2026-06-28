"""Encode neutral agent run events as Vercel UI Message Stream parts."""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, Optional

from ...dtos import AgentResult
from ...streaming import AgentStream
from .messages import TOOL_APPROVAL_REQUEST


# The AI SDK UI message stream (`ai@6`) validates the `finish` frame's
# `finishReason` against this closed set. The runner surfaces the model's raw
# stop reason (e.g. Anthropic `end_turn`, OpenAI `length`), so map it on the way
# out; an unmapped reason falls back to `unknown` rather than failing validation.
_AI_SDK_FINISH_REASONS = frozenset(
    {"stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"}
)

_FINISH_REASON_MAP = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool-calls",
    "tool_calls": "tool-calls",
    "function_call": "tool-calls",
    "refusal": "content-filter",
    "content_filter": "content-filter",
    # A HITL park ends the turn intentionally-but-incomplete (the FE then resumes on the
    # user's decision). It is neither a model completion nor an error, so map it to the AI
    # SDK's `other` rather than letting it fall through to `unknown` (F-040).
    "paused": "other",
    "cancelled": "other",
}


def _map_finish_reason(stop_reason: Optional[str]) -> Optional[str]:
    """Map a raw model stop reason onto the AI SDK ``finishReason`` enum.

    Returns ``None`` when there is no stop reason (the frame then omits it).
    Already-valid values pass through; unknown reasons become ``"unknown"``.
    """
    if stop_reason is None:
        return None
    normalized = stop_reason.strip().lower()
    if normalized in _AI_SDK_FINISH_REASONS:
        return normalized
    return _FINISH_REASON_MAP.get(normalized, "unknown")


async def agent_run_to_vercel_parts(
    run: AgentStream,
    *,
    session_id: Optional[str] = None,
    message_id: str = "msg-1",
    trace_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Project a live ``AgentStream`` into Vercel UI Message Stream part dictionaries.

    DEVELOPMENT-ONLY. The live path is :func:`agent_stream_to_vercel_stream` in the routing
    layer, which projects the handler's agenta event stream (not an ``AgentStream``). This
    run-based variant pairs with the dev-only one-shot ``AgentStream`` debugging surface and is
    kept for that; it is not on any live request path.
    """
    start: Dict[str, Any] = {"type": "start", "messageId": message_id}
    if session_id is not None:
        start["messageMetadata"] = {"sessionId": session_id}
    yield start
    yield {"type": "start-step"}

    text_seq = 0
    reasoning_seq = 0
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    # Tool-call ids already surfaced as a tool part. An approval request attaches
    # to its tool part by id, so we synthesize one only when none preceded it.
    seen_tool_calls: set = set()

    try:
        async for event in run:
            etype = event.type
            data = event.data

            if etype == "message":
                text_seq += 1
                tid = f"text-{text_seq}"
                yield {"type": "text-start", "id": tid}
                yield {"type": "text-delta", "id": tid, "delta": data.get("text", "")}
                yield {"type": "text-end", "id": tid}
            elif etype == "message_start":
                yield {"type": "text-start", "id": data.get("id")}
            elif etype == "message_delta":
                yield {
                    "type": "text-delta",
                    "id": data.get("id"),
                    "delta": data.get("delta", ""),
                }
            elif etype == "message_end":
                yield {"type": "text-end", "id": data.get("id")}
            elif etype == "thought":
                reasoning_seq += 1
                rid = f"reasoning-{reasoning_seq}"
                yield {"type": "reasoning-start", "id": rid}
                yield {
                    "type": "reasoning-delta",
                    "id": rid,
                    "delta": data.get("text", ""),
                }
                yield {"type": "reasoning-end", "id": rid}
            elif etype == "thought_start":
                yield {"type": "reasoning-start", "id": data.get("id")}
            elif etype == "thought_delta":
                yield {
                    "type": "reasoning-delta",
                    "id": data.get("id"),
                    "delta": data.get("delta", ""),
                }
            elif etype == "thought_end":
                yield {"type": "reasoning-end", "id": data.get("id")}
            elif etype == "tool_call":
                tool_call_id = data.get("id")
                tool_name = data.get("name")
                seen_tool_calls.add(tool_call_id)
                yield {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": data.get("input"),
                }
                if data.get("render") is not None:
                    yield _render_part(tool_call_id, data["render"])
            elif etype == "tool_result":
                tool_call_id = data.get("id")
                if data.get("denied"):
                    yield {
                        "type": "tool-output-denied",
                        "toolCallId": tool_call_id,
                    }
                elif data.get("isError"):
                    yield {
                        "type": "tool-output-error",
                        "toolCallId": tool_call_id,
                        "errorText": _as_text(data.get("output")),
                    }
                else:
                    structured = data.get("data")
                    out = structured if structured is not None else data.get("output")
                    yield {
                        "type": "tool-output-available",
                        "toolCallId": tool_call_id,
                        "output": out,
                    }
                    if data.get("render") is not None:
                        yield _render_part(tool_call_id, data["render"])
            elif etype == "interaction_request":
                for part in _interaction_parts(data, seen_tool_calls):
                    yield part
            elif etype == "data":
                part: Dict[str, Any] = {
                    "type": f"data-{data.get('name', 'data')}",
                    "data": data.get("data"),
                }
                if data.get("transient"):
                    part["transient"] = True
                yield part
            elif etype == "file":
                yield {
                    "type": "file",
                    "url": data.get("url"),
                    "mediaType": data.get("mediaType"),
                }
            elif etype == "usage":
                usage = _usage_metadata(data)
            elif etype == "error":
                yield {"type": "error", "errorText": data.get("message", "")}
            elif etype == "done":
                stop_reason = data.get("stopReason")
    except Exception as exc:
        yield {"type": "error", "errorText": str(exc)}
        return

    if usage is None or trace_id is None:
        result = _safe_result(run)
        if result is not None:
            if usage is None:
                usage = _usage_metadata(result.usage or {})
                if stop_reason is None:
                    stop_reason = result.stop_reason
            if trace_id is None:
                trace_id = result.trace_id

    yield {"type": "finish-step"}
    finish: Dict[str, Any] = {"type": "finish"}
    finish_reason = _map_finish_reason(stop_reason)
    if finish_reason is not None:
        finish["finishReason"] = finish_reason
    metadata: Dict[str, Any] = {}
    if usage:
        metadata["usage"] = usage
    if trace_id is not None:
        metadata["traceId"] = trace_id
    if metadata:
        finish["messageMetadata"] = metadata
    yield finish


async def agent_stream_to_vercel_stream(
    events: AsyncIterator[Dict[str, Any]],
    *,
    session_id: Optional[str] = None,
    message_id: str = "msg-1",
    trace_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Project a stream of neutral agenta events into Vercel UI Message Stream parts.

    The routing-layer counterpart of :func:`agent_run_to_vercel_parts`. It consumes the agenta
    event stream the handler yields (each event a ``{"type", "data"}`` dict) — NOT an
    ``AgentStream`` — so the projection lives outside the workflow boundary, where format
    negotiation belongs. ``usage`` and ``stop_reason`` are read from the in-stream ``usage`` /
    ``done`` events; ``trace_id`` is passed in by routing (off the response), since there is no
    run to fall back to here.
    """
    start: Dict[str, Any] = {"type": "start", "messageId": message_id}
    if session_id is not None:
        start["messageMetadata"] = {"sessionId": session_id}
    yield start
    yield {"type": "start-step"}

    text_seq = 0
    reasoning_seq = 0
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    seen_tool_calls: set = set()

    try:
        async for event in events:
            etype = event.get("type")
            data = event.get("data") or {}

            if etype == "message":
                text_seq += 1
                tid = f"text-{text_seq}"
                yield {"type": "text-start", "id": tid}
                yield {"type": "text-delta", "id": tid, "delta": data.get("text", "")}
                yield {"type": "text-end", "id": tid}
            elif etype == "message_start":
                yield {"type": "text-start", "id": data.get("id")}
            elif etype == "message_delta":
                yield {
                    "type": "text-delta",
                    "id": data.get("id"),
                    "delta": data.get("delta", ""),
                }
            elif etype == "message_end":
                yield {"type": "text-end", "id": data.get("id")}
            elif etype == "thought":
                reasoning_seq += 1
                rid = f"reasoning-{reasoning_seq}"
                yield {"type": "reasoning-start", "id": rid}
                yield {
                    "type": "reasoning-delta",
                    "id": rid,
                    "delta": data.get("text", ""),
                }
                yield {"type": "reasoning-end", "id": rid}
            elif etype == "thought_start":
                yield {"type": "reasoning-start", "id": data.get("id")}
            elif etype == "thought_delta":
                yield {
                    "type": "reasoning-delta",
                    "id": data.get("id"),
                    "delta": data.get("delta", ""),
                }
            elif etype == "thought_end":
                yield {"type": "reasoning-end", "id": data.get("id")}
            elif etype == "tool_call":
                tool_call_id = data.get("id")
                tool_name = data.get("name")
                seen_tool_calls.add(tool_call_id)
                yield {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": data.get("input"),
                }
                if data.get("render") is not None:
                    yield _render_part(tool_call_id, data["render"])
            elif etype == "tool_result":
                tool_call_id = data.get("id")
                if data.get("denied"):
                    yield {
                        "type": "tool-output-denied",
                        "toolCallId": tool_call_id,
                    }
                elif data.get("isError"):
                    yield {
                        "type": "tool-output-error",
                        "toolCallId": tool_call_id,
                        "errorText": _as_text(data.get("output")),
                    }
                else:
                    structured = data.get("data")
                    out = structured if structured is not None else data.get("output")
                    yield {
                        "type": "tool-output-available",
                        "toolCallId": tool_call_id,
                        "output": out,
                    }
                    if data.get("render") is not None:
                        yield _render_part(tool_call_id, data["render"])
            elif etype == "interaction_request":
                for part in _interaction_parts(data, seen_tool_calls):
                    yield part
            elif etype == "data":
                part: Dict[str, Any] = {
                    "type": f"data-{data.get('name', 'data')}",
                    "data": data.get("data"),
                }
                if data.get("transient"):
                    part["transient"] = True
                yield part
            elif etype == "file":
                yield {
                    "type": "file",
                    "url": data.get("url"),
                    "mediaType": data.get("mediaType"),
                }
            elif etype == "usage":
                usage = _usage_metadata(data)
            elif etype == "error":
                yield {"type": "error", "errorText": data.get("message", "")}
            elif etype == "done":
                stop_reason = data.get("stopReason")
    except Exception as exc:
        yield {"type": "error", "errorText": str(exc)}
        return

    yield {"type": "finish-step"}
    finish: Dict[str, Any] = {"type": "finish"}
    finish_reason = _map_finish_reason(stop_reason)
    if finish_reason is not None:
        finish["finishReason"] = finish_reason
    metadata: Dict[str, Any] = {}
    if usage:
        metadata["usage"] = usage
    if trace_id is not None:
        metadata["traceId"] = trace_id
    if metadata:
        finish["messageMetadata"] = metadata
    yield finish


def _interaction_parts(
    data: Dict[str, Any], seen_tool_calls: set
) -> Iterator[Dict[str, Any]]:
    """Project a neutral ``interaction_request`` event to Vercel stream parts.

    A ``permission`` request becomes the AI SDK ``tool-approval-request`` chunk,
    which is a strict object (only ``type``/``approvalId``/``toolCallId``) and
    attaches to the tool part with the same ``toolCallId``. The runner normally
    emits that tool call first; if it didn't, synthesize a tool part from the
    request payload so the approval has something to render against.
    """
    kind = data.get("kind")
    payload = data.get("payload") or {}
    if kind == "permission":
        tool_call_id = _approval_tool_call_id(payload)
        tool_call = payload.get("toolCall")
        if tool_call_id is not None and isinstance(tool_call, dict):
            tool_name = (
                tool_call.get("name") or tool_call.get("title") or tool_call.get("kind")
            )
            real_input = tool_call.get("rawInput") or tool_call.get("input")
            if tool_call_id not in seen_tool_calls:
                # The runner parked without first surfacing the tool call, so
                # synthesize a tool part for the approval to render against.
                seen_tool_calls.add(tool_call_id)
                yield {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": real_input,
                }
            elif real_input:
                # The tool call was already surfaced, often with empty input on a
                # cold-replay resume. The approval request carries the real args, so
                # re-emit `tool-input-available` to refresh the parked call's input
                # instead of persisting `{}` (HITL approve-empty-input bug).
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": real_input,
                }
        yield {
            "type": TOOL_APPROVAL_REQUEST,
            "approvalId": data.get("id"),
            "toolCallId": tool_call_id,
        }
        return
    if kind == "input":
        yield {"type": "data-input-request", "id": data.get("id"), "data": payload}
        return
    yield {
        "type": "data-interaction",
        "id": data.get("id"),
        "data": {"kind": kind, "payload": payload},
    }


def _render_part(tool_call_id: Any, render: Any) -> Dict[str, Any]:
    """Carry an agenta render hint as a custom ``data-render`` part.

    The AI SDK ``tool-input/output-available`` chunks are strict objects with no
    ``render`` field, so the hint rides a sibling data part keyed by
    ``toolCallId`` instead of inline on the tool part.
    """
    return {
        "type": "data-render",
        "data": {"toolCallId": tool_call_id, "render": render},
    }


def _approval_tool_call_id(payload: Dict[str, Any]) -> Optional[Any]:
    tool_call_id = payload.get("toolCallId")
    if tool_call_id is not None:
        return tool_call_id
    tool_call = payload.get("toolCall")
    if isinstance(tool_call, dict):
        return tool_call.get("id") or tool_call.get("toolCallId")
    return None


def _usage_metadata(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: data[key]
        for key in ("input", "output", "total", "cost")
        if data.get(key) is not None
    }


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def _safe_result(run: AgentStream) -> Optional[AgentResult]:
    try:
        return run.result()
    except Exception:
        return None


# Back-compat alias for the former flat module API.
ui_message_stream = agent_run_to_vercel_parts
