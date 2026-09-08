import html
import re
from typing import Any, Dict, List, Optional, Tuple

from oss.src.core.channels.dtos import ChannelSpaceKind

MAX_CHARS = 4096
# callback_data is capped at 64 BYTES by Telegram; above the row limit we
# degrade to numbered text, the same discipline as Slack's button cap.
BUTTONS_MAX = 8
CALLBACK_DATA_MAX_BYTES = 64

# The per-bot ingress path carries the bot id, since a Telegram update never
# names the bot it is for: /telegram/events/{routing_token}/. The routing token
# is the bot id for a custom bot (public; the secret header is the auth).
_PATH_TOKEN_RE = re.compile(r"/telegram/events/(?P<token>[^/]+)")


def routing_token_from_path(path: str) -> Optional[str]:
    """The token segment of a per-bot webhook path, or None if the path is not
    a Telegram ingress path."""

    match = _PATH_TOKEN_RE.search(path or "")
    return match.group("token") if match else None


def classify_space_kind(message: Dict[str, Any]) -> ChannelSpaceKind:
    """chat.type private -> PRIVATE; a forum topic (message_thread_id in a
    supergroup) -> TOPIC; any other group/supergroup -> GROUP."""

    chat = message.get("chat") or {}
    chat_type = chat.get("type")
    if chat_type == "private":
        return ChannelSpaceKind.PRIVATE
    if message.get("message_thread_id") and chat.get("is_forum"):
        return ChannelSpaceKind.TOPIC
    return ChannelSpaceKind.GROUP


def build_locator(
    *, chat_id: Any, message_thread_id: Optional[Any] = None
) -> Dict[str, Any]:
    """chat_id always; message_thread_id only when present, so the space unit
    never carries a null thread field."""

    locator: Dict[str, Any] = {"chat_id": chat_id}
    if message_thread_id:
        locator["message_thread_id"] = message_thread_id
    return locator


def is_bot_authored(message: Dict[str, Any], *, bot_id: Optional[int]) -> bool:
    """The domain must never treat the bot's own posts as input."""

    sender = message.get("from") or {}
    if sender.get("is_bot"):
        return True
    if bot_id is not None and sender.get("id") == bot_id:
        return True
    return False


def _entities_text(message: Dict[str, Any]) -> str:
    return message.get("text") or message.get("caption") or ""


def is_addressed(
    message: Dict[str, Any],
    *,
    space_kind: ChannelSpaceKind,
    bot_id: Optional[int],
    bot_username: Optional[str],
) -> bool:
    """The adapter's answer to trigger-or-fill. A private chat is always
    addressed to the bot. In a group the message must @mention the bot, carry a
    /command, or reply to one of the bot's own messages."""

    if space_kind == ChannelSpaceKind.PRIVATE:
        return True

    text = _entities_text(message)
    entities = message.get("entities") or message.get("caption_entities") or []
    for entity in entities:
        etype = entity.get("type")
        if etype == "bot_command":
            return True
        if etype == "mention" and bot_username:
            offset = entity.get("offset", 0)
            length = entity.get("length", 0)
            mentioned = text[offset : offset + length]
            if mentioned.lower() == f"@{bot_username}".lower():
                return True
        if etype == "text_mention":
            user = entity.get("user") or {}
            if bot_id is not None and user.get("id") == bot_id:
                return True

    reply = message.get("reply_to_message") or {}
    reply_from = reply.get("from") or {}
    if bot_id is not None and reply_from.get("id") == bot_id:
        return True

    return False


def to_html(text: str) -> str:
    """Escape text so parse_mode=HTML renders it safely. Rich formatting from
    the render layer is a later step; for now this guarantees a valid HTML
    body that never breaks on a stray <, > or &."""

    return html.escape(text, quote=False)


def split_for_max_chars(text: str, *, max_chars: int = MAX_CHARS) -> List[str]:
    """Split rather than truncate."""

    if len(text) <= max_chars:
        return [text]

    parts: List[str] = []
    remaining = text
    while remaining:
        parts.append(remaining[:max_chars])
        remaining = remaining[max_chars:]
    return parts


def _within_callback_limit(value: str) -> bool:
    return len(value.encode("utf-8")) <= CALLBACK_DATA_MAX_BYTES


def render_content(
    content: List[Dict[str, Any]],
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Flatten internal content parts into (HTML text, reply_markup).

    Buttons render as an inline keyboard, one button per row, using the button
    value as callback_data. Above BUTTONS_MAX, or when a value exceeds the
    64-byte callback limit, buttons degrade to numbered text with no markup.
    """

    buttons = [item for item in content if item.get("type") == "button"]
    texts = [item.get("text", "") for item in content if item.get("type") == "text"]

    text = "\n".join(t for t in texts if t)

    options = [
        {
            "label": b.get("label", b.get("id", "")),
            "value": b.get("value") or b.get("id", ""),
        }
        for b in buttons
    ]

    fits = all(_within_callback_limit(o["value"]) for o in options)
    if options and len(options) <= BUTTONS_MAX and fits:
        keyboard = [
            [{"text": o["label"], "callback_data": o["value"]}] for o in options
        ]
        return to_html(text) if text else " ", {"inline_keyboard": keyboard}

    if options:
        numbered = "\n".join(f"{i + 1}. {o['label']}" for i, o in enumerate(options))
        text = f"{text}\n{numbered}" if text else numbered

    return to_html(text) if text else " ", None
