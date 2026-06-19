"""Encode neutral agent run events as Vercel UI Message Stream parts."""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Optional

from ...dtos import AgentResult
from ...streaming import AgentRun
from .messages import TOOL_APPROVAL_REQUEST


async def agent_run_to_vercel_parts(
    run: AgentRun,
    *,
    session_id: Optional[str] = None,
    message_id: str = "msg-1",
    trace_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Project a live ``AgentRun`` into Vercel UI Message Stream part dictionaries."""
    start: Dict[str, Any] = {"type": "start", "messageId": message_id}
    if session_id is not None:
        start["messageMetadata"] = {"sessionId": session_id}
    yield start
    yield {"type": "start-step"}

    text_seq = 0
    reasoning_seq = 0
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None

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
            elif etype == "reasoning_start":
                yield {"type": "reasoning-start", "id": data.get("id")}
            elif etype == "reasoning_delta":
                yield {
                    "type": "reasoning-delta",
                    "id": data.get("id"),
                    "delta": data.get("delta", ""),
                }
            elif etype == "reasoning_end":
                yield {"type": "reasoning-end", "id": data.get("id")}
            elif etype == "tool_call":
                tool_call_id = data.get("id")
                tool_name = data.get("name")
                yield {
                    "type": "tool-input-start",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                }
                available: Dict[str, Any] = {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "input": data.get("input"),
                }
                if data.get("render") is not None:
                    available["render"] = data["render"]
                yield available
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
                    available = {
                        "type": "tool-output-available",
                        "toolCallId": tool_call_id,
                        "output": out,
                    }
                    if data.get("render") is not None:
                        available["render"] = data["render"]
                    yield available
            elif etype == "interaction_request":
                yield _interaction_part(data)
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
    if stop_reason is not None:
        finish["finishReason"] = stop_reason
    metadata: Dict[str, Any] = {}
    if usage:
        metadata["usage"] = usage
    if trace_id is not None:
        metadata["traceId"] = trace_id
    if metadata:
        finish["messageMetadata"] = metadata
    yield finish


def _interaction_part(data: Dict[str, Any]) -> Dict[str, Any]:
    """Project a neutral ``interaction_request`` event to a Vercel stream part."""
    kind = data.get("kind")
    payload = data.get("payload") or {}
    if kind == "permission":
        return {
            "type": TOOL_APPROVAL_REQUEST,
            "approvalId": data.get("id"),
            "toolCallId": _approval_tool_call_id(payload),
            "availableReplies": payload.get("availableReplies"),
            "toolCall": payload.get("toolCall"),
        }
    if kind == "input":
        return {"type": "data-input-request", "id": data.get("id"), "data": payload}
    return {
        "type": "data-interaction",
        "id": data.get("id"),
        "data": {"kind": kind, "payload": payload},
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


def _safe_result(run: AgentRun) -> Optional[AgentResult]:
    try:
        return run.result()
    except Exception:
        return None


# Back-compat alias for the former flat module API.
ui_message_stream = agent_run_to_vercel_parts
