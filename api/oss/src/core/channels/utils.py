from datetime import datetime
from json import dumps
from typing import Any, Dict, Optional
from uuid import NAMESPACE_DNS, UUID, uuid5

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelEffectivePolicy,
    ChannelKeyGrain,
    ChannelPolicy,
)
from oss.src.core.channels.types import ChannelLocatorIncomplete


_CHANNELS = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "channels")


def canonical_json(value: Any) -> str:
    """Sorted keys, fixed separators — the key must not depend on dict ordering."""

    return dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def compose_external_key(
    capabilities: ChannelCapabilities,
    grain: ChannelKeyGrain,
    locator: Dict[str, Any],
) -> Optional[UUID]:
    """uuid5 over the adapter's declared key fields for this grain.

    Returns None at THREAD grain when the declaration names no thread fields —
    the platform-has-no-threads case, which degrades to the space's own scope.
    Raises ChannelLocatorIncomplete when a declared field is missing from the
    locator: a key composed from a partial locator is a silent thread fork.
    """

    fields = capabilities.identity.keys.get(grain) or []

    if not fields:
        return None

    subset = {}

    for field in fields:
        if field not in locator:
            raise ChannelLocatorIncomplete(
                channel=capabilities.channel,
                grain=grain.value,
                missing=field,
            )

        subset[field] = locator[field]

    return uuid5(_CHANNELS, canonical_json(subset))


def compose_outbox_key(
    *,
    thread_id: UUID,
    turn_id: str,
    item: int,
) -> UUID:
    """The item's identity — what we are sending. Stored; derived once at insert."""

    return uuid5(_CHANNELS, f"{thread_id}:{turn_id}:{item}")


def compose_idempotency_key(
    *,
    key: UUID,
    updated_at: datetime,
) -> UUID:
    """The wire token — one request. Derived at send time, never stored."""

    return uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")


def resolve_policy(
    capabilities: ChannelCapabilities,
    channel_defaults: ChannelPolicy,
    *levels: Optional[ChannelPolicy],
) -> ChannelEffectivePolicy:
    """Start from the channel defaults, then intersect every stated level.

    booleans: any stated False wins. sets: intersect every stated set. enums:
    the narrowest stated value, by SESSION_SCOPE_ORDER. Unstated everywhere:
    fall through to the channel defaults.
    """

    raise NotImplementedError
