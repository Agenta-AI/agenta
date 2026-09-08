from datetime import datetime
from json import dumps
from typing import Any, Dict, List, Optional
from uuid import NAMESPACE_DNS, UUID, uuid5

from oss.src.core.channels.dtos import (
    SESSION_SCOPE_ORDER,
    ChannelCapabilities,
    ChannelEffectivePolicy,
    ChannelGrant,
    ChannelGrantEffect,
    ChannelKeyGrain,
    ChannelPolicy,
    ChannelPolicyLevel,
    ChannelSessionScope,
)
from oss.src.core.channels.types import (
    ChannelConnectionKeyUndeclared,
    ChannelLocatorIncomplete,
)


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
    Raises ChannelConnectionKeyUndeclared at CONNECTION grain on the same empty
    declaration: there is no legitimate "no connection identity" case, and a
    silent None there would resolve to no connection and refuse every event.
    Raises ChannelLocatorIncomplete when a declared field is missing from the
    locator: a key composed from a partial locator is a silent thread fork.
    """

    fields = capabilities.identity.keys.get(grain) or []

    if not fields:
        if grain is ChannelKeyGrain.CONNECTION:
            raise ChannelConnectionKeyUndeclared(channel=capabilities.channel)
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
    updated_at: Optional[datetime],
) -> UUID:
    """The wire token — one request. Derived at send time, never stored.

    `updated_at` is null until a row is first edited (no server default, unlike
    `created_at`), so a first send keys off the row's identity alone; every
    later revision keys off its own timestamp.
    """

    if updated_at is None:
        return uuid5(_CHANNELS, str(key))

    return uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")


# positional order of *levels in every call site: agent, space, grant
_LEVEL_ORDER = (
    ChannelPolicyLevel.AGENT,
    ChannelPolicyLevel.SPACE,
    ChannelPolicyLevel.GRANT,
)


def resolve_policy(
    capabilities: ChannelCapabilities,
    channel_defaults: ChannelPolicy,
    *levels: Optional[ChannelPolicy],
) -> ChannelEffectivePolicy:
    """Start from the channel defaults, then intersect every stated level.

    booleans: any stated False wins. sets: intersect every stated set. enums:
    the narrowest stated value, by SESSION_SCOPE_ORDER. Unstated everywhere:
    fall through to the channel defaults. The capability declaration is the
    outermost, uneditable level and always contributes a decision.
    """

    stated_levels = list(zip(_LEVEL_ORDER, levels))

    # --- booleans: capability denial, then any stated False, else the default #

    def resolve_bool(field: str, capability_supported: bool):
        if not capability_supported:
            return False, ChannelPolicyLevel.CAPABILITY

        stated = [
            (level, getattr(policy, field))
            for level, policy in stated_levels
            if policy is not None and getattr(policy, field) is not None
        ]

        for level, value in stated:
            if value is False:
                return False, level

        if stated:
            # every stated value is True here (False already returned above)
            return True, stated[0][0]

        return getattr(channel_defaults, field), ChannelPolicyLevel.CHANNEL

    backfill, backfill_by = resolve_bool(
        "backfill", capabilities.fill.backfill.supported
    )
    forwardfill, forwardfill_by = resolve_bool(
        "forwardfill", capabilities.fill.forwardfill.supported
    )

    # --- sets: intersect every stated level, else the default ------------- #

    stated_triggers = [
        (level, policy.triggers)
        for level, policy in stated_levels
        if policy is not None and policy.triggers is not None
    ]

    if stated_triggers:
        triggers = set.intersection(*(value for _, value in stated_triggers))
        triggers_by = stated_triggers[-1][0]
    else:
        triggers = channel_defaults.triggers or set()
        triggers_by = ChannelPolicyLevel.CHANNEL

    # --- enums: narrowest stated value, capability units as the ceiling --- #

    stated_scopes = [
        (level, policy.session_scope)
        for level, policy in stated_levels
        if policy is not None and policy.session_scope is not None
    ]

    if stated_scopes:
        session_scope_by, session_scope = max(
            stated_scopes, key=lambda pair: SESSION_SCOPE_ORDER.index(pair[1])
        )
    else:
        session_scope = channel_defaults.session_scope
        session_scope_by = ChannelPolicyLevel.CHANNEL

    # `units` is a grain vocabulary (thread|space), not a scope one
    # (thread|message): MESSAGE is always available and never declared, so the
    # ceiling can only take THREAD away.
    if (
        session_scope is ChannelSessionScope.THREAD
        and ChannelKeyGrain.THREAD not in capabilities.conversation.units
    ):
        session_scope = ChannelSessionScope.MESSAGE
        session_scope_by = ChannelPolicyLevel.CAPABILITY

    return ChannelEffectivePolicy(
        triggers=triggers,
        session_scope=session_scope,
        backfill=backfill,
        forwardfill=forwardfill,
        decided_by={
            "triggers": triggers_by,
            "session_scope": session_scope_by,
            "backfill": backfill_by,
            "forwardfill": forwardfill_by,
        },
    )


def evaluate_grant_effect(grants: List[ChannelGrant]) -> Optional[ChannelGrantEffect]:
    """Deny-first over a set of grants already filtered to "matches this
    space, by id or by kind". Any DENY refuses regardless of specificity;
    else any ALLOW admits; else None -- no rule, default-deny at the caller."""

    if any(grant.effect is ChannelGrantEffect.DENY for grant in grants):
        return ChannelGrantEffect.DENY

    if any(grant.effect is ChannelGrantEffect.ALLOW for grant in grants):
        return ChannelGrantEffect.ALLOW

    return None
