from typing import Any, Dict, List

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.render.dtos import RenderItem, RenderPart

INDICATOR_TEXT = "Working…"


def render_indicator(*, capabilities: ChannelCapabilities) -> RenderItem:
    """Turn-started. One text part; nothing here ever needs a split or a card."""

    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text=INDICATOR_TEXT,
                format=capabilities.rendering.text.format,
            )
        ]
    )


def render_turn_result(
    *,
    capabilities: ChannelCapabilities,
    folded: Dict[str, Any],
) -> List[RenderItem]:
    """The fold result -> one or more independently-postable items.

    `folded` is exactly fold()'s return: {messages, stop_reason,
    pending_interaction}. A paused turn renders its card from
    pending_interaction's recorded tool call, never from message text —
    this hard exclusion holds regardless of stop_reason.
    """

    pending_interaction = folded.get("pending_interaction")

    if folded.get("stop_reason") == "paused" and pending_interaction is not None:
        return [_render_pending_interaction(capabilities, pending_interaction)]

    text = _extract_answer_text(folded.get("messages") or [])

    return _render_text(capabilities, text)


def _render_pending_interaction(
    capabilities: ChannelCapabilities,
    pending_interaction: Dict[str, Any],
) -> RenderItem:
    payload = pending_interaction.get("payload")
    tool_call = payload.get("toolCall") if isinstance(payload, dict) else None
    arguments = None
    if isinstance(tool_call, dict):
        arguments = tool_call.get("arguments") or tool_call.get("input")

    tool = pending_interaction.get("tool")
    title = f"Approval needed: {tool}" if tool else "Approval needed"

    options = [("Approve", "approve"), ("Deny", "deny")]

    buttons_supported = capabilities.rendering.buttons.supported
    max_buttons = capabilities.rendering.buttons.max

    if buttons_supported and len(options) <= max_buttons:
        return RenderItem(
            parts=[
                RenderPart(
                    type="card",
                    title=title,
                    tool=tool,
                    arguments=arguments if isinstance(arguments, dict) else None,
                ),
                *(
                    RenderPart(type="button", id=str(i), label=label, value=value)
                    for i, (label, value) in enumerate(options)
                ),
            ]
        )

    # buttons unsupported, or the option count exceeds the declared max
    lines = [title]
    for i, (label, _) in enumerate(options, start=1):
        lines.append(f"{i}. {label}")
    lines.append("Reply with the number to choose.")

    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text="\n".join(lines),
                format=capabilities.rendering.text.format,
            )
        ]
    )


def _extract_answer_text(messages: List[Dict[str, Any]]) -> str:
    """Only what fold() already surfaced as message content — never a raw
    thought/usage event."""

    parts: List[str] = []
    for message in messages:
        if message.get("role") != "assistant":
            continue
        content = message.get("content")
        if isinstance(content, str) and content:
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])

    return "\n".join(parts)


def _render_text(
    capabilities: ChannelCapabilities,
    text: str,
) -> List[RenderItem]:
    max_chars = capabilities.rendering.text.max_chars
    chunks = _split_text(text, max_chars) if max_chars else [text]

    return [
        RenderItem(
            parts=[
                RenderPart(
                    type="text",
                    text=chunk,
                    format=capabilities.rendering.text.format,
                )
            ]
        )
        for chunk in chunks
    ]


def _split_text(text: str, max_chars: int) -> List[str]:
    if max_chars <= 0 or len(text) <= max_chars:
        return [text]

    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]
