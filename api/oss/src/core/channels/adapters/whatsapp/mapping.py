"""Pure mapping between Meta's WhatsApp Cloud API shapes and core's. No I/O:
the adapter owns the HTTP calls, this module owns the payloads."""

import hashlib
import hmac
import json
import re
import secrets
from collections.abc import Mapping
from typing import Any

from oss.src.core.channels.adapters.whatsapp.capabilities import (
    LIST_ROWS_MAX,
    REPLY_BUTTONS_MAX,
    TEXT_MAX_CHARS,
)
from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)
from oss.src.core.channels.render.approval import approval_details
from oss.src.core.channels.types import ChannelSignatureInvalid

# Interactive message limits (Cloud API reference, reply buttons and lists).
INTERACTIVE_BODY_MAX_CHARS = 1024
BUTTON_TITLE_MAX_CHARS = 20
LIST_ROW_TITLE_MAX_CHARS = 24
LIST_BUTTON_TEXT = "Choose"

_SIGNATURE_HEADER = "x-hub-signature-256"

# Message types we pass to the agent. Everything else a customer can send
# (voice notes, video, stickers, locations, contact cards) gets one fixed
# reply instead of a turn; reactions and system notices are dropped.
_MEDIA_TYPES = ("image", "document")
_UNSUPPORTED_LABELS = {
    "audio": "[voice note]",
    "video": "[video]",
    "sticker": "[sticker]",
    "location": "[location]",
    "contacts": "[contact card]",
}


# --- webhook ------------------------------------------------------------- #


def parse_body(body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(body) if body else {}
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _changes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Every `value` in the body. One POST can batch several entries, each
    with several changes, and each change names its own phone number."""

    values: list[dict[str, Any]] = []
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            if not isinstance(change, dict) or change.get("field") != "messages":
                continue
            value = change.get("value")
            if isinstance(value, dict):
                values.append(value)
    return values


def _phone_number_id(value: dict[str, Any]) -> str | None:
    metadata = value.get("metadata") or {}
    pid = metadata.get("phone_number_id")
    return str(pid) if pid else None


def phone_number_ids(body: bytes) -> list[str]:
    """The distinct business numbers a webhook body speaks for, in order."""

    seen: list[str] = []
    for value in _changes(parse_body(body)):
        pid = _phone_number_id(value)
        if pid and pid not in seen:
            seen.append(pid)
    return seen


def parse_events(*, body: bytes, phone_number_id: str) -> list[ChannelInboundEvent]:
    """One event per customer message addressed to `phone_number_id`. Messages
    for another number in the same body are left for that number's own pass."""

    events: list[ChannelInboundEvent] = []
    for value in _changes(parse_body(body)):
        if _phone_number_id(value) != phone_number_id:
            continue
        names = {
            str(contact.get("wa_id")): (contact.get("profile") or {}).get("name")
            for contact in value.get("contacts") or []
            if isinstance(contact, dict)
        }
        for message in value.get("messages") or []:
            if isinstance(message, dict):
                event = _parse_message(message, names=names)
                if event is not None:
                    events.append(event)
    return events


def failed_statuses(body: bytes) -> list[dict[str, Any]]:
    """Meta's asynchronous `failed` delivery statuses, for the log. v1 does not
    write them back onto the outbox row."""

    failed: list[dict[str, Any]] = []
    for value in _changes(parse_body(body)):
        for status in value.get("statuses") or []:
            if isinstance(status, dict) and status.get("status") == "failed":
                errors = status.get("errors") or [{}]
                failed.append(
                    {
                        "message_id": status.get("id"),
                        "code": (errors[0] or {}).get("code"),
                        "title": (errors[0] or {}).get("title"),
                    }
                )
    return failed


def _parse_message(
    message: dict[str, Any], *, names: dict[str, Any]
) -> ChannelInboundEvent | None:
    wa_id = message.get("from")
    message_id = message.get("id")
    if not wa_id or not message_id:
        return None
    # v1 is one-to-one. A group message (Groups API) is not ours to answer.
    if message.get("group_id"):
        return None

    kind = ChannelEventKind.MESSAGE
    mtype = message.get("type")
    content: list[dict[str, Any]]

    if mtype == "text":
        content = [
            {"type": "text", "text": (message.get("text") or {}).get("body", "")}
        ]
    elif mtype == "interactive":
        interactive = message.get("interactive") or {}
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        token = reply.get("id")
        if not token:
            return None
        # A tap carries the choice token we set as the button or row id; core
        # resolves it against the thread's pending choice, like a Slack click.
        kind = ChannelEventKind.ACTION
        content = [{"type": "text", "text": token}]
    elif mtype == "button":
        # A quick-reply button on a template (the re-open template): the
        # customer wrote back, which is an ordinary message.
        content = [
            {"type": "text", "text": (message.get("button") or {}).get("text", "")}
        ]
    elif mtype in _MEDIA_TYPES:
        media = message.get(mtype) or {}
        content = []
        if media.get("caption"):
            content.append({"type": "text", "text": media["caption"]})
        content.append(
            {
                "type": "media",
                "kind": mtype,
                "media_id": media.get("id"),
                "mime_type": media.get("mime_type"),
                "filename": media.get("filename"),
            }
        )
    elif mtype in _UNSUPPORTED_LABELS:
        content = [
            {"type": "text", "text": _UNSUPPORTED_LABELS[mtype], "unsupported": True}
        ]
    else:
        # reactions, system notices, Meta's own "unsupported" type
        return None

    sender: dict[str, Any] = {"id": str(wa_id)}
    name = names.get(str(wa_id))
    if name:
        sender["name"] = name

    return ChannelInboundEvent(
        external_id=str(message_id),
        kind=kind,
        space_kind=ChannelSpaceKind.PRIVATE,
        external_locator={"wa_id": str(wa_id)},
        processed=ChannelInboxEventProcessed(content=content, sender=sender),
        addressed=True,
    )


# --- signature and webhook registration ---------------------------------- #


def verify_signature(
    *, headers: Mapping[str, str], body: bytes, app_secret: str
) -> None:
    """Raise ChannelSignatureInvalid unless X-Hub-Signature-256 is the
    HMAC-SHA256 of the raw body keyed with the app secret. `headers` must have
    lower-cased keys."""

    presented = headers.get(_SIGNATURE_HEADER) or ""
    if not app_secret or not presented.startswith("sha256="):
        raise ChannelSignatureInvalid(channel="whatsapp")
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(
        presented[len("sha256=") :].encode("utf-8"), expected.encode("utf-8")
    ):
        raise ChannelSignatureInvalid(channel="whatsapp")


def mint_verify_token(phone_number_id: str) -> str:
    """The token the operator pastes into Meta's webhook form. It starts with
    the phone number ID, so the verify handshake (which names no number) can
    find its connection without a scan."""

    return f"{phone_number_id}.{secrets.token_urlsafe(24)}"


def phone_number_id_from_verify_token(token: str) -> str | None:
    head, dot, _ = (token or "").partition(".")
    return head if dot and head.isdigit() else None


# --- outbound ------------------------------------------------------------ #


_FENCE_SPLIT = re.compile(r"(```.*?```)", re.DOTALL)


def markdown_to_whatsapp(text: str) -> str:
    """The Markdown the agent writes, in WhatsApp's own marks: *bold*,
    _italic_, ~strike~. Code fences are left as they are (WhatsApp renders
    ``` too). Links become "text (url)"."""

    pieces = _FENCE_SPLIT.split(text)
    for i in range(0, len(pieces), 2):
        piece = pieces[i]
        piece = re.sub(
            r"^#{1,6}\s+(.+?)\s*#*$", "\x00\\1\x00", piece, flags=re.MULTILINE
        )
        piece = re.sub(r"\*\*(.+?)\*\*", "\x00\\1\x00", piece)
        piece = re.sub(r"__(.+?)__", "\x00\\1\x00", piece)
        piece = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"_\1_", piece)
        piece = re.sub(r"~~(.+?)~~", r"~\1~", piece)
        piece = re.sub(r"\[([^\]]+)\]\((\S+?)\)", r"\1 (\2)", piece)
        pieces[i] = piece.replace("\x00", "*")
    return "".join(pieces)


def split_text(text: str, *, max_chars: int = TEXT_MAX_CHARS) -> list[str]:
    """The safety net: core already splits answers at the declared limit on
    paragraph, line and word boundaries. This only catches oversize content
    (a long approval body) that reached the adapter anyway."""

    if len(text) <= max_chars:
        return [text]
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _card_text(card: dict[str, Any]) -> str:
    lines = [card[key] for key in ("title", "text") if card.get(key)]
    lines.append(approval_details(card.get("arguments")))
    return "\n".join(lines)


def build_messages(
    *, content: list[dict[str, Any]], wa_id: str
) -> list[dict[str, Any]]:
    """Core's content parts as Cloud API `/messages` bodies, in send order.

    Text and card parts become the body. Up to 3 buttons become reply buttons
    and 4 to 10 a list message; the body rides on the interactive message.
    More than 10 never reaches here: core renders numbered text instead.
    """

    segments: list[str] = []
    for part in content:
        if part.get("type") == "text" and part.get("text"):
            segments.append(markdown_to_whatsapp(part["text"]))
        elif part.get("type") == "card":
            segments.append(_card_text(part))
    text = "\n".join(segments)

    options = [
        {
            "id": part.get("value") or part.get("id") or "",
            "title": part.get("label") or part.get("value") or "",
        }
        for part in content
        if part.get("type") == "button"
    ]

    envelope = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": wa_id,
    }

    if not options:
        return [
            {**envelope, "type": "text", "text": {"body": chunk, "preview_url": False}}
            for chunk in split_text(text or " ")
        ]

    body = {"text": _clip(text or "Choose an option.", INTERACTIVE_BODY_MAX_CHARS)}
    if len(options) <= REPLY_BUTTONS_MAX:
        action: dict[str, Any] = {
            "buttons": [
                {
                    "type": "reply",
                    "reply": {
                        "id": option["id"],
                        "title": _clip(option["title"], BUTTON_TITLE_MAX_CHARS),
                    },
                }
                for option in options
            ]
        }
        interactive = {"type": "button", "body": body, "action": action}
    else:
        rows = [
            {
                "id": option["id"],
                "title": _clip(option["title"], LIST_ROW_TITLE_MAX_CHARS),
            }
            for option in options[:LIST_ROWS_MAX]
        ]
        interactive = {
            "type": "list",
            "body": body,
            "action": {
                "button": LIST_BUTTON_TEXT,
                "sections": [{"title": "Options", "rows": rows}],
            },
        }
    return [{**envelope, "type": "interactive", "interactive": interactive}]
