"""Pure mapping between Discord's shapes and core's. No I/O: the adapter owns
the REST calls, this module owns the payloads."""

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from oss.src.core.channels.adapters.discord.capabilities import (
    BUTTONS_MAX,
    TEXT_MAX_CHARS,
)
from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)
from oss.src.core.channels.render.approval import approval_details

# Application flags that let the bot read message content.
GATEWAY_MESSAGE_CONTENT = 1 << 18
GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19

# View Channels, Send Messages, Send Messages in Threads, Create Public
# Threads, Read Message History, Add Reactions, Attach Files, Embed Links.
INVITE_PERMISSIONS = 309237763136

# Channel types whose messages sit inside a thread.
_THREAD_CHANNEL_TYPES = {10, 11, 12}
# DEFAULT and REPLY. Every other message type is a system notice.
_PERSON_MESSAGE_TYPES = {0, 19}

_INTERACTION_MESSAGE_COMPONENT = 3
_COMPONENT_ACTION_ROW = 1
_COMPONENT_BUTTON = 2
_BUTTON_STYLE_SECONDARY = 2

CUSTOM_ID_MAX_CHARS = 100
BUTTON_LABEL_MAX_CHARS = 80
THREAD_NAME_MAX_CHARS = 100


def parse_body(body: bytes) -> Dict[str, Any]:
    try:
        payload = json.loads(body) if body else {}
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def message_content_enabled(flags: Any) -> bool:
    if not isinstance(flags, int):
        return False
    return bool(flags & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED))


def invite_url(application_id: str) -> str:
    return (
        "https://discord.com/oauth2/authorize"
        f"?client_id={application_id}&scope=bot&permissions={INVITE_PERMISSIONS}"
    )


# --- locators ------------------------------------------------------------ #


def is_thread_channel(channel_type: Any) -> bool:
    return channel_type in _THREAD_CHANNEL_TYPES


def build_locator(
    *,
    guild_id: Optional[str],
    source_channel_id: str,
    message_id: str,
    parent_id: Optional[str] = None,
) -> Dict[str, Any]:
    """`channel_id` is the text channel (the space) and `thread_id` the
    Discord thread. A message inside a thread names its parent channel as
    `parent_id`. A top-level server message is keyed by its own id, because
    the thread started from it gets the same id. A DM has no thread."""

    if not guild_id:
        channel_id, thread_id = source_channel_id, ""
    elif parent_id:
        channel_id, thread_id = parent_id, source_channel_id
    else:
        channel_id, thread_id = source_channel_id, message_id
    return {
        "guild_id": guild_id or "",
        "channel_id": channel_id,
        "thread_id": thread_id,
        "source_channel_id": source_channel_id,
        "message_id": message_id,
    }


def opens_thread(locator: Dict[str, Any]) -> bool:
    """True when replies go into a thread that starts from the message
    itself, so the thread may not exist yet."""

    thread_id = locator.get("thread_id")
    return bool(
        thread_id
        and thread_id == locator.get("message_id")
        and locator.get("source_channel_id") != thread_id
    )


def reply_channel_id(locator: Dict[str, Any]) -> str:
    """Where replies go. A receipt names only the channel its message sits
    in."""

    return (
        locator.get("thread_id")
        or locator.get("channel_id")
        or locator["source_channel_id"]
    )


# --- inbound ------------------------------------------------------------- #


def is_person_message(message: Dict[str, Any]) -> bool:
    return message.get("type", 0) in _PERSON_MESSAGE_TYPES


def is_bot_authored(message: Dict[str, Any], *, bot_user_id: Optional[str]) -> bool:
    """The bot's own posts, other bots and webhooks are never input."""

    author = message.get("author") or {}
    if author.get("bot") or message.get("webhook_id"):
        return True
    return bool(bot_user_id) and str(author.get("id")) == bot_user_id


def mentions_bot(message: Dict[str, Any], *, bot_user_id: Optional[str]) -> bool:
    if not bot_user_id:
        return False
    return any(
        isinstance(user, dict) and str(user.get("id")) == bot_user_id
        for user in message.get("mentions") or []
    )


def _readable_text(text: str, *, bot_user_id: Optional[str], handle: str) -> str:
    """The bot's own mention as a readable handle: `<@123…>` is noise to the
    agent."""

    if not bot_user_id:
        return text
    return re.sub(rf"<@!?{re.escape(bot_user_id)}>", handle, text)


def _sender(message: Dict[str, Any]) -> Dict[str, Any]:
    author = message.get("author") or {}
    member = message.get("member") or {}
    sender: Dict[str, Any] = {"id": str(author.get("id") or "")}
    name = member.get("nick") or author.get("global_name") or author.get("username")
    if name:
        sender["name"] = name
    if author.get("username"):
        sender["username"] = author["username"]
    return sender


def _sent_at(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _thread_name(text: str, *, fallback: str) -> str:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return (first_line or fallback)[:THREAD_NAME_MAX_CHARS]


def parse_message(
    message: Dict[str, Any],
    *,
    guild_id: Optional[str],
    parent_id: Optional[str],
    bot_user_id: Optional[str],
    bot_username: Optional[str],
    title: Optional[str] = None,
) -> Optional[ChannelInboundEvent]:
    """A person's message as an event, or None for the bot's own posts,
    other bots and system notices. `parent_id` is the parent text channel
    when the message was posted inside a thread, and `title` that text
    channel's name."""

    message_id = message.get("id")
    source_channel_id = message.get("channel_id")
    if not message_id or not source_channel_id:
        return None
    if not is_person_message(message) or is_bot_authored(
        message, bot_user_id=bot_user_id
    ):
        return None

    locator = build_locator(
        guild_id=guild_id,
        source_channel_id=str(source_channel_id),
        message_id=str(message_id),
        parent_id=parent_id,
    )
    handle = f"@{bot_username}" if bot_username else "@Agenta"
    text = _readable_text(
        message.get("content") or "", bot_user_id=bot_user_id, handle=handle
    )
    if opens_thread(locator):
        locator["thread_name"] = _thread_name(text, fallback=handle)
    if title:
        locator["title"] = title

    return ChannelInboundEvent(
        external_id=str(message_id),
        kind=ChannelEventKind.MESSAGE,
        space_kind=ChannelSpaceKind.TOPIC if guild_id else ChannelSpaceKind.PRIVATE,
        external_locator=locator,
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": text}],
            sender=_sender(message),
            sent_at=_sent_at(message.get("timestamp")),
            message_ref=str(message_id),
        ),
        addressed=mentions_bot(message, bot_user_id=bot_user_id),
    )


def parse_interaction(interaction: Dict[str, Any]) -> Optional[ChannelInboundEvent]:
    """A button click. The token is the button's `custom_id`, the choice token
    we set; the locator follows the message that holds the button, so the
    click keys to the thread it was posted in. The interaction carries its
    channel object, so a thread's parent needs no lookup."""

    if interaction.get("type") != _INTERACTION_MESSAGE_COMPONENT:
        return None
    data = interaction.get("data") or {}
    token = data.get("custom_id")
    if data.get("component_type") != _COMPONENT_BUTTON or not token:
        return None

    message = interaction.get("message") or {}
    channel = interaction.get("channel") or {}
    source_channel_id = interaction.get("channel_id") or channel.get("id")
    if not interaction.get("id") or not message.get("id") or not source_channel_id:
        return None

    guild_id = interaction.get("guild_id")
    parent_id = (
        channel.get("parent_id") if is_thread_channel(channel.get("type")) else None
    )
    user = (
        (interaction.get("member") or {}).get("user") or interaction.get("user") or {}
    )

    return ChannelInboundEvent(
        external_id=str(interaction["id"]),
        kind=ChannelEventKind.ACTION,
        space_kind=ChannelSpaceKind.TOPIC if guild_id else ChannelSpaceKind.PRIVATE,
        external_locator=build_locator(
            guild_id=guild_id,
            source_channel_id=str(source_channel_id),
            message_id=str(message["id"]),
            parent_id=str(parent_id) if parent_id else None,
        ),
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": token}],
            sender=_sender({"author": user, "member": interaction.get("member")}),
            message_ref=str(message["id"]),
        ),
        addressed=True,
    )


# --- outbound ------------------------------------------------------------ #


def split_text(text: str, *, max_chars: int = TEXT_MAX_CHARS) -> List[str]:
    """The safety net: core already splits answers at the declared limit,
    keeping code blocks whole. This only catches oversize content that
    reached the adapter anyway, such as a long approval card."""

    if len(text) <= max_chars:
        return [text]
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


def _card_text(card: Dict[str, Any]) -> str:
    lines = [card[key] for key in ("title", "text") if card.get(key)]
    lines.append(approval_details(card.get("arguments")))
    return "\n".join(lines)


def _action_row(options: List[Dict[str, str]]) -> Dict[str, Any]:
    return {
        "type": _COMPONENT_ACTION_ROW,
        "components": [
            {
                "type": _COMPONENT_BUTTON,
                "style": _BUTTON_STYLE_SECONDARY,
                "label": option["label"][:BUTTON_LABEL_MAX_CHARS],
                "custom_id": option["value"],
            }
            for option in options
        ],
    }


def render_content(
    content: List[Dict[str, Any]],
) -> Tuple[str, Optional[List[Dict[str, Any]]]]:
    """Core's content parts as (Markdown text, components). Up to BUTTONS_MAX
    buttons fit in one action row. Above it, or when a token exceeds the
    `custom_id` limit, buttons degrade to numbered text."""

    segments: List[str] = []
    for part in content:
        if part.get("type") == "text" and part.get("text"):
            segments.append(part["text"])
        elif part.get("type") == "card":
            segments.append(_card_text(part))
    text = "\n".join(segments)

    options = [
        {
            "label": part.get("label") or part.get("value") or "",
            "value": part.get("value") or part.get("id") or "",
        }
        for part in content
        if part.get("type") == "button"
    ]
    fits = all(0 < len(o["value"]) <= CUSTOM_ID_MAX_CHARS for o in options)
    if options and len(options) <= BUTTONS_MAX and fits:
        return text, [_action_row(options)]

    if options:
        numbered = "\n".join(f"{i + 1}. {o['label']}" for i, o in enumerate(options))
        text = f"{text}\n{numbered}" if text else numbered
    return text, None


def build_messages(content: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """`POST /channels/{id}/messages` bodies, in send order. The buttons ride
    on the last message. The agent's words never ping anyone."""

    text, components = render_content(content)
    if not text and not components:
        return []  # Discord refuses a message with nothing in it
    bodies: List[Dict[str, Any]] = [
        {"content": chunk, "allowed_mentions": {"parse": []}}
        for chunk in split_text(text)
    ]
    if components:
        bodies[-1]["components"] = components
    return bodies
