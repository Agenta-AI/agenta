"""UI message codec: translate between the Vercel AI SDK ``UIMessage`` wire shape and the
neutral agent runtime types (``Message`` / ``AgentEvent`` / ``AgentResult``).

This is the ``/messages`` egress adapter, the parts-aware sibling of
:func:`agenta.sdk.agents.to_messages` (which only understands the ``/invoke`` ``{role,
content}`` shape). The neutral types in ``dtos.py`` stay the port; this module is one more
adapter behind that seam, so the ``/run`` runner wire (``utils/wire.py``, ``{role, content}``)
is unchanged — the Vercel shape lives only at the HTTP edge.

Three directions:

- :func:`from_ui_messages` — inbound ``UIMessage[]`` -> ``List[Message]``. Text and file parts
  fold into content blocks; tool and approval parts are PRESERVED as structured ``tool_call`` /
  ``tool_result`` :class:`~agenta.sdk.agents.dtos.ContentBlock`s (never flattened to text), so a
  cross-turn human-in-the-loop reply replays as a real tool turn and the model resumes from the
  result. The runner's message transcript renders these blocks into the cold replay.
- :func:`to_ui_message` — outbound ``AgentResult`` / ``Message`` -> one ``UIMessage`` dict, for
  the ``load-session`` history.
- :func:`ui_message_stream` — the streaming edge: a live
  :class:`~agenta.sdk.agents.streaming.AgentRun` -> Vercel UI Message Stream parts
  (``start`` ... ``finish``). The SSE framing and the terminal ``data: [DONE]`` are added by the
  routing layer (``_vercel_sse_stream``); this generator yields the part dicts only.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

from .dtos import AgentResult, ContentBlock, Message
from .streaming import AgentRun

# Inbound UIMessage part type names handled specially (the rest of ``tool-*`` is a tool call).
_TOOL_APPROVAL_REQUEST = "tool-approval-request"
_TOOL_APPROVAL_RESPONSE = "tool-approval-response"
_TOOL_OUTPUT_AVAILABLE = "tool-output-available"


# ---------------------------------------------------------------------------
# Inbound: UIMessage[] -> List[Message]
# ---------------------------------------------------------------------------


def from_ui_messages(raw: Optional[List[Any]]) -> List[Message]:
    """Coerce inbound Vercel ``UIMessage`` objects into neutral :class:`Message` objects.

    The parts-aware sibling of :func:`agenta.sdk.agents.to_messages`. Tool and approval parts
    are preserved as structured tool-call / tool-result content blocks (never dropped), so a
    cross-turn human-in-the-loop reply resumes the pending interaction on the next turn.
    """
    messages: List[Message] = []
    for item in raw or []:
        message = _ui_message_to_message(item)
        if message is not None:
            messages.append(message)
    return messages


def _ui_message_to_message(raw: Any) -> Optional[Message]:
    if isinstance(raw, Message):
        return raw
    if not isinstance(raw, dict) or "role" not in raw:
        return None
    role = str(raw["role"])

    parts = raw.get("parts")
    if parts is None:
        # Not a parts-based UIMessage — fall back to the {role, content} shape so a mixed
        # history still parses.
        return Message.from_raw(raw)

    blocks: List[ContentBlock] = []
    for part in parts or []:
        blocks.extend(_part_to_blocks(part))

    if not blocks:
        return Message(role=role, content="")
    # Collapse an all-text message to a plain string (the shape the runner replays); keep the
    # block list when any structured (file / tool) content is present.
    if all(block.type == "text" for block in blocks):
        return Message(role=role, content="".join(block.text or "" for block in blocks))
    return Message(role=role, content=blocks)


def _part_to_blocks(part: Any) -> List[ContentBlock]:
    if not isinstance(part, dict):
        return []
    ptype = str(part.get("type", ""))

    if ptype == "text":
        text = part.get("text")
        return [ContentBlock(type="text", text=text)] if text is not None else []

    if ptype == "file":
        media = part.get("mediaType") or part.get("mimeType")
        kind = (
            "image"
            if isinstance(media, str) and media.startswith("image/")
            else "resource"
        )
        return [
            ContentBlock(
                type=kind,
                uri=part.get("url") or part.get("uri"),
                data=part.get("data"),
                mime_type=media,
            )
        ]

    if ptype == _TOOL_APPROVAL_REQUEST:
        # The server's own request, echoed back in history; regenerated on replay, not input.
        return []

    if ptype == _TOOL_APPROVAL_RESPONSE:
        return _approval_response_blocks(part)

    if (
        ptype == _TOOL_OUTPUT_AVAILABLE
        or ptype == "dynamic-tool"
        or ptype.startswith("tool-")
    ):
        return _tool_part_blocks(part, ptype)

    # reasoning / step-start / data-* parts are the assistant's own output or transient UI;
    # they are not model input on replay, so they are dropped.
    return []


def _tool_part_blocks(part: Dict[str, Any], ptype: str) -> List[ContentBlock]:
    """A Vercel tool part -> a ``tool_call`` block plus, when resolved, a ``tool_result``.

    Field names match what the runner's transcript renders: ``toolCallId`` / ``toolName`` /
    ``input`` / ``output`` / ``isError`` (via :meth:`ContentBlock.to_wire`).
    """
    tool_call_id = part.get("toolCallId") or part.get("tool_call_id")
    tool_name = part.get("toolName") or part.get("tool_name")
    if (
        tool_name is None
        and ptype.startswith("tool-")
        and ptype != _TOOL_OUTPUT_AVAILABLE
    ):
        tool_name = ptype[len("tool-") :]

    blocks: List[ContentBlock] = []

    # The call itself (a bare tool-output-available part carries only a result).
    if ptype != _TOOL_OUTPUT_AVAILABLE or "input" in part:
        blocks.append(
            ContentBlock(
                type="tool_call",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                input=part.get("input"),
            )
        )

    state = part.get("state")
    error_text = part.get("errorText")
    if error_text is not None or state == "output-error":
        blocks.append(
            ContentBlock(
                type="tool_result",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                output=error_text if error_text is not None else part.get("output"),
                is_error=True,
            )
        )
    elif "output" in part or state == "output-available":
        blocks.append(
            ContentBlock(
                type="tool_result",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                output=part.get("output"),
                is_error=False,
            )
        )
    return blocks


def _approval_response_blocks(part: Dict[str, Any]) -> List[ContentBlock]:
    """A cross-turn ``tool-approval-response`` reply -> a ``tool_result`` keyed by toolCallId,
    so the runtime matches the pending interaction and resumes (the resolve step is joint)."""
    tool_call_id = (
        part.get("toolCallId") or part.get("tool_call_id") or part.get("approvalId")
    )
    output = part.get("output")
    if output is None:
        approved = part.get("approved")
        output = {"approved": approved} if approved is not None else part.get("reason")
    return [ContentBlock(type="tool_result", tool_call_id=tool_call_id, output=output)]


# ---------------------------------------------------------------------------
# Outbound (batch): AgentResult / Message -> one UIMessage dict
# ---------------------------------------------------------------------------


def to_ui_message(source: Any, *, message_id: str = "msg-1") -> Dict[str, Any]:
    """Render an :class:`AgentResult` or :class:`Message` as one Vercel ``UIMessage`` dict
    (the shape ``load-session`` returns and ``useChat`` takes as its initial messages)."""
    if isinstance(source, AgentResult):
        return {
            "id": message_id,
            "role": "assistant",
            "parts": [{"type": "text", "text": source.output or ""}],
        }
    if isinstance(source, Message):
        return {
            "id": message_id,
            "role": source.role,
            "parts": _content_to_parts(source.content),
        }
    raise TypeError(
        f"to_ui_message expects an AgentResult or Message, got {type(source).__name__!r}"
    )


def _content_to_parts(content: Any) -> List[Dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    parts: List[Dict[str, Any]] = []
    for block in content or []:
        parts.extend(_block_to_parts(block))
    return parts


def _block_to_parts(block: ContentBlock) -> List[Dict[str, Any]]:
    if block.type == "text":
        return [{"type": "text", "text": block.text or ""}]
    if block.type in ("image", "resource"):
        part: Dict[str, Any] = {"type": "file"}
        if block.uri is not None:
            part["url"] = block.uri
        if block.mime_type is not None:
            part["mediaType"] = block.mime_type
        if block.data is not None:
            part["data"] = block.data
        return [part]
    if block.type == "tool_call":
        return [
            {
                "type": f"tool-{block.tool_name or 'tool'}",
                "toolCallId": block.tool_call_id,
                "state": "input-available",
                "input": block.input,
            }
        ]
    if block.type == "tool_result":
        return [
            {
                "type": f"tool-{block.tool_name or 'tool'}",
                "toolCallId": block.tool_call_id,
                "state": "output-error" if block.is_error else "output-available",
                "output": block.output,
            }
        ]
    return []


# ---------------------------------------------------------------------------
# Streaming edge: a live AgentRun -> Vercel UI Message Stream parts
# ---------------------------------------------------------------------------


async def ui_message_stream(
    run: AgentRun,
    *,
    session_id: Optional[str] = None,
    message_id: str = "msg-1",
    trace_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Encode a live :class:`AgentRun` as Vercel UI Message Stream part dicts.

    Consumes the run's live ``AgentEvent`` stream and yields parts as they arrive: ``start``
    (carrying ``messageMetadata.sessionId``) first, then the body, then ``finish`` (carrying
    ``messageMetadata.traceId`` so the client can open the run's OTel trace, RFC §6.1). The SSE
    framing and the terminal ``data: [DONE]`` are added by the routing layer
    (``_vercel_sse_stream``). On a terminal run failure the run raises while iterating; that is
    surfaced as an ``error`` part (RFC §8.2) and the stream ends without a ``finish``.
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
                    # A human denied the tool, so it never ran (RFC: emit tool-output-denied
                    # instead of tool-output-available; the FE renders the output-denied state).
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
                    # Prefer the structured object (generative UI); fall back to the text form.
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
            # unknown event types are ignored
    except Exception as exc:  # AgentRun raises on a terminal ok=false result
        yield {"type": "error", "errorText": str(exc)}
        return

    # Pull usage and the trace id from the terminal result when not already known, the same
    # fallback both lean on (RFC §6.1: the finish trace id matches the JSON response's).
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
    # usage and traceId coexist under messageMetadata; the client reads message.metadata.traceId.
    metadata: Dict[str, Any] = {}
    if usage:
        metadata["usage"] = usage
    if trace_id is not None:
        metadata["traceId"] = trace_id
    if metadata:
        finish["messageMetadata"] = metadata
    yield finish


def _interaction_part(data: Dict[str, Any]) -> Dict[str, Any]:
    """Project an ``interaction_request`` event to a Vercel part. Permission -> an approval
    request; input -> a forward-looking input part; any other kind (e.g. ``client_tool``) ->
    a generic interaction part so it is surfaced, not dropped (the resolve step is joint)."""
    kind = data.get("kind")
    payload = data.get("payload") or {}
    if kind == "permission":
        return {
            "type": _TOOL_APPROVAL_REQUEST,
            "approvalId": data.get("id"),
            # REQUIRED alongside approvalId (RFC / AI SDK chunk): the gated tool's call id, so
            # the FE binds the approval to its existing tool part and the inbound
            # tool-approval-response (keyed by toolCallId) correlates back for the cross-turn
            # resume. Prefer the top-level toolCallId the runner emits; fall back to the nested
            # ACP toolCall detail (id / toolCallId).
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
    """The gated tool's call id for a ``tool-approval-request``. The runner stamps a top-level
    ``toolCallId`` on the permission payload; if it is absent, dig it out of the nested ACP
    ``toolCall`` detail (``id`` / ``toolCallId``)."""
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
    except Exception:  # result not available (stream not fully consumed / failed)
        return None
