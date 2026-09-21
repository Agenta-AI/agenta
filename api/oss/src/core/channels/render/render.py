from typing import Any, Dict, List, Optional

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.render.dtos import RenderChoiceOption, RenderItem, RenderPart
from oss.src.core.channels.render.markdown_html import markdown_to_telegram_html_chunks

INDICATOR_TEXT = "Thinking…"
# The turn ended and nothing came back: said out loud in the chat, so a failed
# run is never a placeholder that sits there forever.
NO_ANSWER_TEXT = (
    "The agent run failed and produced no answer. Check the session in Agenta."
)
# Appended to a partial answer while the turn is still running.
PROGRESS_CURSOR = " …"


def render_indicator(*, capabilities: ChannelCapabilities) -> RenderItem:
    """Turn-started. One text part; nothing here ever needs a split or a card."""

    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text=INDICATOR_TEXT,
                # plain: the adapter escapes it; only rendered answers are html
                format=_plain_or_declared(capabilities),
                indicator=True,
            )
        ]
    )


def render_thinking(*, capabilities: ChannelCapabilities, tick: int) -> RenderItem:
    """The indicator with its dots moving (one to three), edited in place
    while the turn has produced no text yet."""

    dots = "." * (tick % 3 + 1)
    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text=f"Thinking{dots}",
                format=_plain_or_declared(capabilities),
                indicator=True,
            )
        ]
    )


def render_progress(*, capabilities: ChannelCapabilities, text: str) -> RenderItem:
    """The answer so far, edited into the indicator while the turn runs. One
    item only: the first message's worth, with a cursor; the full result is
    posted when the turn ends."""

    max_chars = capabilities.rendering.text.max_chars
    budget = max_chars - len(PROGRESS_CURSOR) if max_chars else 0
    first = _render_text(capabilities, text, max_chars=budget)[0].parts[0]
    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text=f"{first.text}{PROGRESS_CURSOR}",
                format=first.format,
            )
        ]
    )


def render_no_answer(*, capabilities: ChannelCapabilities) -> RenderItem:
    return RenderItem(
        parts=[
            RenderPart(
                type="text",
                text=NO_ANSWER_TEXT,
                format=_plain_or_declared(capabilities),
            )
        ]
    )


def _plain_or_declared(capabilities: ChannelCapabilities) -> str:
    """html channels escape plain parts themselves; markdown/plain channels
    take the declared format as before."""

    declared = capabilities.rendering.text.format
    return "plain" if declared == "html" else declared


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

    text = extract_answer_text(folded.get("messages") or [])

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
    interaction_id = pending_interaction.get("id")
    interaction_id = str(interaction_id) if interaction_id else None

    options = [("Approve", "approve"), ("Deny", "deny")]
    choice = [RenderChoiceOption(label=label, token=value) for label, value in options]

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
            ],
            choice=choice,
            interaction_id=interaction_id,
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
        ],
        choice=choice,
        interaction_id=interaction_id,
    )


def extract_answer_text(messages: List[Dict[str, Any]]) -> str:
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
    *,
    max_chars: Optional[int] = None,
) -> List[RenderItem]:
    declared = capabilities.rendering.text.format
    limit = capabilities.rendering.text.max_chars if max_chars is None else max_chars
    if declared == "html":
        # The agent wrote Markdown; the html channel gets it rendered into its
        # tag set, chunked between blocks so no message holds a half tag.
        chunks = markdown_to_telegram_html_chunks(text, limit)
    else:
        chunks = _split_text(text, limit) if limit else [text]

    return [
        RenderItem(parts=[RenderPart(type="text", text=chunk, format=declared)])
        for chunk in chunks
    ]


def _split_text(text: str, max_chars: int) -> List[str]:
    if max_chars <= 0 or len(text) <= max_chars:
        return [text]

    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]
