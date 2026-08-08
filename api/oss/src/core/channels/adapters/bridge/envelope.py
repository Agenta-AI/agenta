"""The versioned CloudEvents-shaped envelope: parse inbound events, serialise
outbound delivery commands. Dispatch is by `type`, never by field-shape
sniffing -- a future `.v2` is a new type name beside this one, not a reshaped
`.v1`.
"""

from typing import Any, Dict, List, Optional

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)

MESSAGE_RECEIVED_V1 = "io.agenta.channel.message.received.v1"

_SPACE_KIND_BY_WIRE = {
    "private": ChannelSpaceKind.PRIVATE,
    "group": ChannelSpaceKind.GROUP,
    "topic": ChannelSpaceKind.TOPIC,
}


def parse_inbound_envelope(payload: Dict[str, Any]) -> Optional[ChannelInboundEvent]:
    """CloudEvents envelope -> the normalised event, or None for a type this
    package does not act on. Unknown top-level fields are dropped by simply
    never being read; an unrecognised `type` is ignored, not raised."""

    if payload.get("type") != MESSAGE_RECEIVED_V1:
        return None

    data = payload.get("data") or {}
    space = data.get("space") or {}
    sender = data.get("sender") or {}
    # data.native rides along, unread -- platform-specific and not part of
    # the normalised event this package produces.

    locator = space.get("locator") or {}
    space_kind = _SPACE_KIND_BY_WIRE.get(space.get("type"), ChannelSpaceKind.TOPIC)

    content: List[Dict[str, Any]] = list(data.get("content") or [])

    return ChannelInboundEvent(
        external_id=str(payload.get("id") or ""),
        kind=ChannelEventKind.MESSAGE,
        space_kind=space_kind,
        space_locator=dict(locator),
        # this bridge shape carries no separate thread locator on the wire;
        # a bridge with threads addresses them inside its own locator fields
        thread_locator=None,
        external_locator=dict(locator),
        processed=ChannelInboxEventProcessed(
            content=content,
            sender=dict(sender),
        ),
        addressed=bool(data.get("addressed", False)),
    )


def build_delivery_command(
    *,
    idempotency_key: str,
    locator: Dict[str, Any],
    content: List[Dict[str, Any]],
    edit: bool = False,
) -> Dict[str, Any]:
    """The outbound delivery command. `edit` selects the command's own type
    name, not a reshaping of the post command's fields."""

    command_type = (
        "io.agenta.channel.message.edit.v1"
        if edit
        else "io.agenta.channel.message.deliver.v1"
    )

    return {
        "type": command_type,
        "idempotency_key": idempotency_key,
        "data": {
            "locator": dict(locator),
            "content": list(content),
        },
    }


def parse_receipt(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A `bridge.receipt` -> its opaque `external_locator`, or None for an
    explicit bridge-reported failure (`payload.get("error")` set) -- the
    bridge's own diagnosis, never inferred from an empty locator."""

    if payload.get("type") != "bridge.receipt":
        return None

    if payload.get("error") is not None:
        return None

    return dict(payload.get("external_locator") or {})
