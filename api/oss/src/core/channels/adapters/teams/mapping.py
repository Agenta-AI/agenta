"""Pure mapping between Teams activities and core's shapes. No I/O: the
adapter owns the HTTP calls, this module owns the payloads."""

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)

_SPACE_KINDS = {
    "personal": ChannelSpaceKind.PRIVATE,
    "groupChat": ChannelSpaceKind.GROUP,
    "channel": ChannelSpaceKind.TOPIC,
}

_MESSAGE_ID_SUFFIX = re.compile(r";messageid=([^;]+)", re.IGNORECASE)
# Teams sends seven fractional digits; `fromisoformat` takes at most six
# before Python 3.12.
_FRACTION = re.compile(r"(\.\d{6})\d+")

_APP_ID_PREFIXES = ("28:", "api://botid-", "api://")


def parse_body(body: bytes) -> Dict[str, Any]:
    try:
        payload = json.loads(body) if body else {}
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


# --- ids ----------------------------------------------------------------- #


def bare_app_id(value: Any) -> Optional[str]:
    """The bot's application id as a bare lowercase GUID, from any wire form:
    `28:<app_id>` (recipient and mention ids), `api://<app_id>` and
    `api://botid-<app_id>` (token audiences), or the bare id."""

    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    for prefix in _APP_ID_PREFIXES:
        if value.lower().startswith(prefix):
            value = value[len(prefix) :]
            break
    return value.lower() or None


def bot_recipient_id(app_id: str) -> str:
    return f"28:{app_id}"


def split_conversation_id(raw: str) -> Tuple[str, str]:
    """`19:abc@thread.tacv2;messageid=111` into `("19:abc@thread.tacv2",
    "111")`. A conversation id without a thread part gives `""`."""

    match = _MESSAGE_ID_SUFFIX.search(raw)
    root = match.group(1) if match else ""
    return raw.split(";", 1)[0], root


def join_conversation_id(conversation_id: str, thread_id: str) -> str:
    """The conversation a reply goes to: the thread of `thread_id` in a
    channel, or the chat itself."""

    return f"{conversation_id};messageid={thread_id}" if thread_id else conversation_id


def tenant_id(activity: Dict[str, Any]) -> Optional[str]:
    tenant = ((activity.get("channelData") or {}).get("tenant") or {}).get("id")
    tenant = tenant or (activity.get("conversation") or {}).get("tenantId")
    return tenant.lower() if isinstance(tenant, str) and tenant else None


def space_kind(activity: Dict[str, Any]) -> Optional[ChannelSpaceKind]:
    return _SPACE_KINDS.get(
        (activity.get("conversation") or {}).get("conversationType")
    )


# --- mentions ------------------------------------------------------------ #


def _bot_mentions(activity: Dict[str, Any], *, app_id: str) -> List[Dict[str, Any]]:
    """The mention entities that name this bot. A tag or a channel mention
    has another id, so it never matches."""

    return [
        entity
        for entity in activity.get("entities") or []
        if isinstance(entity, dict)
        and entity.get("type") == "mention"
        and str((entity.get("mentioned") or {}).get("id") or "").lower()
        == bot_recipient_id(app_id)
    ]


def mentions_bot(activity: Dict[str, Any], *, app_id: str) -> bool:
    return bool(_bot_mentions(activity, app_id=app_id))


def strip_bot_mentions(text: str, activity: Dict[str, Any], *, app_id: str) -> str:
    """The text without the bot's own mention, so a command after the mention
    parses. Other mentions stay."""

    for entity in _bot_mentions(activity, app_id=app_id):
        mention_text = entity.get("text")
        if isinstance(mention_text, str) and mention_text:
            text = text.replace(mention_text, "")
    return text.strip()


# --- inbound ------------------------------------------------------------- #


def choice_token(activity: Dict[str, Any]) -> Optional[str]:
    value = activity.get("value")
    token = value.get("choice_token") if isinstance(value, dict) else None
    return token if isinstance(token, str) and token else None


def _sender(activity: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The Entra object id, the same for one person in every chat and for
    every bot. `from.id` changes per bot, so it is not an identity."""

    author = activity.get("from") or {}
    object_id = author.get("aadObjectId")
    if not isinstance(object_id, str) or not object_id:
        return None
    sender: Dict[str, Any] = {"id": object_id}
    if author.get("name"):
        sender["name"] = author["name"]
    return sender


def _sent_at(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(
            _FRACTION.sub(r"\1", value.replace("Z", "+00:00"))
        )
    except ValueError:
        return None


def _title(activity: Dict[str, Any]) -> Optional[str]:
    channel = (activity.get("channelData") or {}).get("channel") or {}
    name = channel.get("name") or (activity.get("conversation") or {}).get("name")
    return name if isinstance(name, str) and name else None


def build_locator(
    activity: Dict[str, Any], *, kind: ChannelSpaceKind, message_id: str
) -> Optional[Dict[str, Any]]:
    """`conversation_id` never carries `;messageid=`. In a channel,
    `thread_id` is the root of the reply chain: the `messageid` part, or else
    `message_id`, because a top-level post is the root of its own thread (for
    a click, `message_id` is the card's). Chats have no threads, so
    `thread_id` is `""`."""

    raw = (activity.get("conversation") or {}).get("id")
    tenant = tenant_id(activity)
    service_url = activity.get("serviceUrl")
    if not isinstance(raw, str) or not raw or not tenant or not service_url:
        return None
    conversation_id, root = split_conversation_id(raw)
    thread_id = (root or message_id) if kind is ChannelSpaceKind.TOPIC else ""
    return {
        "tenant_id": tenant,
        "conversation_id": conversation_id,
        "thread_id": thread_id,
        "service_url": service_url,
        "message_id": message_id,
    }


def parse_activity(
    activity: Dict[str, Any], *, app_id: str
) -> Optional[ChannelInboundEvent]:
    """A person's message or a card click as an event, or None for every
    other activity. The caller has already checked the tenant."""

    if activity.get("type") != "message":
        return None
    activity_id = activity.get("id")
    kind = space_kind(activity)
    sender = _sender(activity)
    if not activity_id or kind is None or sender is None:
        return None
    activity_id = str(activity_id)

    token = choice_token(activity)
    if token is not None:
        card_id = activity.get("replyToId")
        if not card_id:
            return None
        locator = build_locator(activity, kind=kind, message_id=str(card_id))
        if locator is None:
            return None
        return ChannelInboundEvent(
            external_id=activity_id,
            kind=ChannelEventKind.ACTION,
            space_kind=kind,
            external_locator=locator,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": token}],
                sender=sender,
                sent_at=_sent_at(activity.get("timestamp")),
                message_ref=str(card_id),
            ),
            addressed=True,
        )

    text = activity.get("text")
    if not isinstance(text, str):
        return None
    addressed = mentions_bot(activity, app_id=app_id)
    text = strip_bot_mentions(text, activity, app_id=app_id)
    if not text:
        return None
    locator = build_locator(activity, kind=kind, message_id=activity_id)
    if locator is None:
        return None
    title = _title(activity)
    if title:
        locator["title"] = title

    return ChannelInboundEvent(
        external_id=activity_id,
        kind=ChannelEventKind.MESSAGE,
        space_kind=kind,
        external_locator=locator,
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": text}],
            sender=sender,
            sent_at=_sent_at(activity.get("timestamp")),
            message_ref=activity_id,
        ),
        addressed=addressed,
    )
