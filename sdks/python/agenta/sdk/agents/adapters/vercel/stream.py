"""Encode neutral agent run events as Vercel UI Message Stream parts."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict, Iterator, Optional
from uuid import uuid4

from agenta.sdk.utils.logging import get_module_logger

from ...dtos import AgentResult
from ...streaming import AgentStream
from .messages import TOOL_APPROVAL_REQUEST

log = get_module_logger(__name__)


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
    tool_names_by_id: Dict[Any, Any] = {}

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
                # A repeat tool_call for an already-seen id is an input REFRESH: the runner
                # re-emits the call once the real args arrive on a later ACP tool_call_update
                # (Pi announces the call first with absent/`{}` args). Emit `tool-input-start`
                # only the first time — a second start would reset the FE tool part after its
                # approval/output. Mirrors the seen-id refresh in `_interaction_parts`.
                first_seen = tool_call_id not in seen_tool_calls
                seen_tool_calls.add(tool_call_id)
                # Record the name only on first sight. On a repeat (arg-refresh) keep the
                # best-known name: an intervening approval may have upgraded it to the STABLE
                # spec name, and this refresh carries only the drift-prone ACP title — letting it
                # clobber the spec name re-breaks the cross-turn resume key (the HITL loop).
                if first_seen:
                    tool_names_by_id[tool_call_id] = tool_name
                tool_name = tool_names_by_id.get(tool_call_id) or tool_name
                if first_seen:
                    yield {
                        "type": "tool-input-start",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                    }
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    # Prefer `rawInput` (the tool's real args, per ACP); the runner leaves the
                    # plain `input` empty on some tool-call paths — mirrors the approval /
                    # client-tool reads in `_interaction_parts` so every path shows real args.
                    "input": data.get("rawInput") or data.get("input"),
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
                    committed = _committed_revision_data(
                        tool_names_by_id.get(tool_call_id), out
                    )
                    if committed is not None:
                        yield {
                            "type": "data-committed-revision",
                            "data": committed,
                        }
                    if data.get("render") is not None:
                        yield _render_part(tool_call_id, data["render"])
            elif etype == "interaction_request":
                for part in _interaction_parts(data, seen_tool_calls, tool_names_by_id):
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
    message_id: Optional[str] = None,
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
    # Every turn needs a UNIQUE messageId — the client keys messages by it, so a shared constant
    # collides across turns (duplicate React keys, dropped turns). Prefer the run's trace_id (stable,
    # correlatable), else a fresh uuid.
    resolved_message_id = message_id or (
        f"msg-{trace_id}" if trace_id else f"msg-{uuid4().hex}"
    )
    start: Dict[str, Any] = {"type": "start", "messageId": resolved_message_id}
    if session_id is not None:
        start["messageMetadata"] = {"sessionId": session_id}
    yield start
    yield {"type": "start-step"}

    text_seq = 0
    reasoning_seq = 0
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    seen_tool_calls: set = set()
    tool_names_by_id: Dict[Any, Any] = {}

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
                # A repeat tool_call for an already-seen id is an input REFRESH: the runner
                # re-emits the call once the real args arrive on a later ACP tool_call_update
                # (Pi announces the call first with absent/`{}` args). Emit `tool-input-start`
                # only the first time — a second start would reset the FE tool part after its
                # approval/output. Mirrors the seen-id refresh in `_interaction_parts`.
                first_seen = tool_call_id not in seen_tool_calls
                seen_tool_calls.add(tool_call_id)
                # Record the name only on first sight. On a repeat (arg-refresh) keep the
                # best-known name: an intervening approval may have upgraded it to the STABLE
                # spec name, and this refresh carries only the drift-prone ACP title — letting it
                # clobber the spec name re-breaks the cross-turn resume key (the HITL loop).
                if first_seen:
                    tool_names_by_id[tool_call_id] = tool_name
                tool_name = tool_names_by_id.get(tool_call_id) or tool_name
                if first_seen:
                    yield {
                        "type": "tool-input-start",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                    }
                yield {
                    "type": "tool-input-available",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    # Prefer `rawInput` (the tool's real args, per ACP); the runner leaves the
                    # plain `input` empty on some tool-call paths — mirrors the approval /
                    # client-tool reads in `_interaction_parts` so every path shows real args.
                    "input": data.get("rawInput") or data.get("input"),
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
                    committed = _committed_revision_data(
                        tool_names_by_id.get(tool_call_id), out
                    )
                    if committed is not None:
                        yield {
                            "type": "data-committed-revision",
                            "data": committed,
                        }
                    if data.get("render") is not None:
                        yield _render_part(tool_call_id, data["render"])
            elif etype == "interaction_request":
                for part in _interaction_parts(data, seen_tool_calls, tool_names_by_id):
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
    data: Dict[str, Any],
    seen_tool_calls: set,
    tool_names_by_id: Optional[Dict[Any, Any]] = None,
) -> Iterator[Dict[str, Any]]:
    """Project a neutral ``interaction_request`` event to Vercel stream parts.

    The event ``kind`` is our interactions vocabulary; this adapter maps it to the AI SDK
    wire. A ``user_approval`` request becomes the ``tool-approval-request`` chunk, which is
    a strict object (only ``type``/``approvalId``/``toolCallId``) and attaches to the tool
    part with the same ``toolCallId``. The runner normally emits that tool call first; if it
    didn't, synthesize a tool part from the request payload so the approval has something to
    render against.
    """
    names = tool_names_by_id if tool_names_by_id is not None else {}
    kind = data.get("kind")
    payload = data.get("payload") or {}
    if kind == "user_approval":
        tool_call_id = _approval_tool_call_id(payload)
        tool_call = payload.get("toolCall")
        if tool_call_id is not None and isinstance(tool_call, dict):
            # Prefer the STABLE resolved spec name over the drift-prone ACP title/kind so the
            # part the FE persists (and folds back on resume) keys the same as the live re-raised
            # gate (responder.ts `permissionToolName`). Otherwise the cross-turn key silently
            # stops matching and the gate re-parks every turn (the HITL resume loop).
            tool_name = _approval_tool_name(tool_call)
            # Record it as the AUTHORITATIVE name for this id, so a later arg-refresh tool_call
            # (which carries only the drift-prone ACP title) cannot downgrade it back and re-break
            # the resume key. See the tool_call handler's `tool_names_by_id.get(...)` preference.
            names[tool_call_id] = tool_name
            real_input = tool_call.get("rawInput") or tool_call.get("input")
            # EGRESS side of the HITL key: what name+args the FE persists on the approval part
            # (and folds back on resume). Compare to the runner's live `[HITL] gate` identity.
            log.info(
                "[HITL] egress approval-request id=%s name=%s spec=%s input_keys=%s",
                tool_call_id,
                tool_name,
                (_tool_spec_of(tool_call) or {}).get("name"),
                list(real_input.keys())
                if isinstance(real_input, dict)
                else type(real_input).__name__,
            )
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
                # The tool call was already surfaced (often by the tracing tool_call event, whose
                # name is the ACP title/kind, and often with empty input on a cold-replay resume).
                # Re-emit `tool-input-available` to refresh BOTH the stable `toolName` and the real
                # args, instead of persisting the drift-prone name + `{}` input (HITL
                # approve-empty-input / name-drift bug).
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
    if kind == "user_input":
        yield {"type": "data-input-request", "id": data.get("id"), "data": payload}
        return
    if kind == "client_tool":
        tool_call_id = payload.get("toolCallId")
        tool_call = payload.get("toolCall")
        if tool_call_id is None and isinstance(tool_call, dict):
            tool_call_id = tool_call.get("id") or tool_call.get("toolCallId")
        tool_name = payload.get("toolName")
        if tool_name is None and isinstance(tool_call, dict):
            tool_name = (
                tool_call.get("name") or tool_call.get("title") or tool_call.get("kind")
            )
        real_input = payload.get("input")
        if real_input is None and isinstance(tool_call, dict):
            real_input = tool_call.get("rawInput") or tool_call.get("input")
        if tool_call_id is not None and tool_call_id not in seen_tool_calls:
            seen_tool_calls.add(tool_call_id)
            yield {
                "type": "tool-input-start",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
            }
        if tool_call_id is not None:
            yield {
                "type": "tool-input-available",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "input": real_input,
            }
            if payload.get("render") is not None:
                yield _render_part(tool_call_id, payload["render"])
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


def _tool_spec_of(tool_call: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The resolved agenta tool spec attached to an ACP tool call, under any of its aliases."""
    for key in ("spec", "toolSpec", "resolvedTool", "tool"):
        spec = tool_call.get(key)
        if isinstance(spec, dict):
            return spec
    return None


def _approval_tool_name(tool_call: Dict[str, Any]) -> Optional[Any]:
    """The gated tool's name for the cross-turn resume key.

    Prefer ``resolvedName`` — the recorded ``tool_call`` name the runner stamps on the gate, the
    SAME value the transcript folds into the stored key — so the egress names the part exactly as
    the responder keys it. Then the resolved spec's canonical ``name`` (when a spec exists). Only
    then the ACP display fields (``title``/``kind``), which drift between the park frame and the
    permission frame and were the resume-loop root cause. Falls back to ``name -> title -> kind``.
    """
    spec = _tool_spec_of(tool_call)
    return (
        tool_call.get("resolvedName")
        or (spec or {}).get("name")
        or tool_call.get("name")
        or tool_call.get("title")
        or tool_call.get("kind")
    )


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


def _committed_revision_data(tool_name: Any, output: Any) -> Optional[Dict[str, Any]]:
    """Project a successful commit_revision tool output to the playground refresh event."""
    if tool_name is not None and tool_name != "commit_revision":
        return None

    payload = output
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return None
    if not isinstance(payload, dict) or not payload.get("count"):
        return None

    revision = payload.get("workflow_revision")
    if not isinstance(revision, dict):
        return None

    data = {
        "variantId": revision.get("workflow_variant_id") or revision.get("variant_id"),
        "revisionId": revision.get("id")
        or revision.get("workflow_revision_id")
        or revision.get("revision_id"),
        "version": revision.get("version"),
    }
    if not all(data.values()):
        return None
    return data


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
