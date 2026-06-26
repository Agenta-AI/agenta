"""Vercel ``UIMessage`` conversion at the agent HTTP edge.

This adapter translates between the Vercel AI SDK ``UIMessage`` parts shape and the
neutral agent runtime ``Message`` / ``ContentBlock`` types. The neutral DTOs stay the port;
Vercel-specific part names live here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ...dtos import AgentResult, ContentBlock, Message

TOOL_APPROVAL_REQUEST = "tool-approval-request"
TOOL_APPROVAL_RESPONSE = "tool-approval-response"
TOOL_OUTPUT_AVAILABLE = "tool-output-available"


def vercel_messages_to_agenta_messages(raw: Optional[List[Any]]) -> List[Message]:
    """Coerce inbound Vercel ``UIMessage`` objects into neutral agenta messages."""
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
        return Message.from_raw(raw)

    blocks: List[ContentBlock] = []
    for part in parts or []:
        blocks.extend(_part_to_blocks(part))

    if not blocks:
        return Message(role=role, content="")
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

    if ptype == TOOL_APPROVAL_REQUEST:
        return []

    if ptype == TOOL_APPROVAL_RESPONSE:
        return _approval_response_blocks(part)

    if (
        ptype == TOOL_OUTPUT_AVAILABLE
        or ptype == "dynamic-tool"
        or ptype.startswith("tool-")
    ):
        return _tool_part_blocks(part, ptype)

    return []


def _tool_part_blocks(part: Dict[str, Any], ptype: str) -> List[ContentBlock]:
    """A Vercel tool part -> neutral tool-call/result content blocks."""
    tool_call_id = part.get("toolCallId") or part.get("tool_call_id")
    tool_name = part.get("toolName") or part.get("tool_name")
    if (
        tool_name is None
        and ptype.startswith("tool-")
        and ptype != TOOL_OUTPUT_AVAILABLE
    ):
        tool_name = ptype[len("tool-") :]

    blocks: List[ContentBlock] = []
    if ptype != TOOL_OUTPUT_AVAILABLE or "input" in part:
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
    else:
        # HITL cross-turn resume: the AI SDK keeps the approval decision INLINE on the
        # tool part — `state: "approval-responded"` (approve OR deny) or the terminal
        # `state: "output-denied"` — with `approval.approved`. The verbatim UIMessage
        # path posts this part as-is, so without emitting the `{approved}` envelope here
        # the runner never learns the decision and re-parks the gate (a deny then
        # dead-ends). Translate it into the same `tool_result` envelope the dedicated
        # `tool-approval-response` part produces, keyed by toolCallId, so
        # `extractApprovalDecisions` resolves the parked gate.
        approved = _approval_decision(part, state)
        if approved is not None:
            blocks.append(
                ContentBlock(
                    type="tool_result",
                    tool_call_id=tool_call_id,
                    tool_name=tool_name,
                    output={"approved": approved},
                )
            )
    return blocks


def _approval_decision(part: Dict[str, Any], state: Optional[str]) -> Optional[bool]:
    """The inline HITL decision on a tool part, or ``None`` if it carries none.

    Reads `approval.approved` (the AI SDK shape) and falls back to `output-denied`
    (the terminal deny state has no `approval.approved` flag) meaning denied.
    """
    approval = part.get("approval")
    if isinstance(approval, dict) and isinstance(approval.get("approved"), bool):
        return approval["approved"]
    if state == "output-denied":
        return False
    return None


def _approval_response_blocks(part: Dict[str, Any]) -> List[ContentBlock]:
    """A cross-turn approval reply -> a tool-result block keyed by toolCallId."""
    tool_call_id = (
        part.get("toolCallId") or part.get("tool_call_id") or part.get("approvalId")
    )
    output = part.get("output")
    if output is None:
        approved = part.get("approved")
        output = {"approved": approved} if approved is not None else part.get("reason")
    return [ContentBlock(type="tool_result", tool_call_id=tool_call_id, output=output)]


def message_to_vercel_ui_message(
    source: Any,
    *,
    message_id: str = "msg-1",
) -> Dict[str, Any]:
    """Render one ``AgentResult`` or neutral ``Message`` as one Vercel ``UIMessage``."""
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
        "message_to_vercel_ui_message expects an AgentResult or Message, "
        f"got {type(source).__name__!r}"
    )


def agenta_messages_to_vercel_messages(
    sources: Optional[List[Any]],
) -> List[Dict[str, Any]]:
    """Render neutral agenta messages as a list of Vercel ``UIMessage`` objects."""
    return [
        message_to_vercel_ui_message(source, message_id=f"msg-{i + 1}")
        for i, source in enumerate(sources or [])
    ]


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


# Back-compat aliases for the former flat module API.
vercel_ui_messages_to_messages = vercel_messages_to_agenta_messages
from_ui_messages = vercel_messages_to_agenta_messages
to_ui_message = message_to_vercel_ui_message
