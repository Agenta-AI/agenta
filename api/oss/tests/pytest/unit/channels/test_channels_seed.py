from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelCapabilities,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrant,
    ChannelGrantData,
    ChannelInboundEvent,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelKeyGrain,
    ChannelOutboxEvent,
    ChannelOutboxEventData,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
    ChannelTriggerState,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.channels.types import ChannelLocatorIncomplete
from oss.src.core.channels.utils import (
    compose_external_key,
    compose_idempotency_key,
    compose_outbox_key,
)


SLACK = {
    "channel": "slack",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,
        "commands": {"native": True, "in_conversation": False},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {"supported": True, "requires_permission": "channels:history"},
        "forwardfill": {"supported": True, "requires_permission": "channels:history"},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": True},
        "buttons": {"supported": True, "max": 25},
        "text": {"format": "markdown", "max_chars": 3000},
        "files": {
            "send": {"supported": True, "max_bytes": 1073741824},
            "receive": {"supported": True, "max_bytes": 1073741824},
        },
    },
    "identity": {
        "scope": "workspace",
        "stable": True,
        "keys": {
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "commands": ["new", "sessions", "use"],
}

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1690000000.1"}


@pytest.fixture
def capabilities() -> ChannelCapabilities:
    return ChannelCapabilities(**SLACK)


def test_declaration_parses(capabilities):
    assert capabilities.channel == "slack"
    assert capabilities.conversation.default in capabilities.conversation.units
    assert capabilities.rendering.files.send.supported
    assert capabilities.identity.keys[ChannelKeyGrain.THREAD] == [
        "team",
        "channel",
        "thread_ts",
    ]


def test_grains_compose_distinct_keys(capabilities):
    space = compose_external_key(capabilities, ChannelKeyGrain.SPACE, LOCATOR)
    thread = compose_external_key(capabilities, ChannelKeyGrain.THREAD, LOCATOR)

    assert space != thread


def test_composition_is_canonical(capabilities):
    shuffled = {
        "channel": LOCATOR["channel"],
        "thread_ts": LOCATOR["thread_ts"],
        "team": LOCATOR["team"],
    }

    assert compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, LOCATOR
    ) == compose_external_key(capabilities, ChannelKeyGrain.THREAD, shuffled)


def test_two_threads_in_one_channel_are_distinct(capabilities):
    other = dict(LOCATOR, thread_ts="1690000001.2")

    assert compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, LOCATOR
    ) != compose_external_key(capabilities, ChannelKeyGrain.THREAD, other)


def test_platform_without_threads_composes_none(capabilities):
    capabilities.identity.keys[ChannelKeyGrain.THREAD] = []

    assert compose_external_key(capabilities, ChannelKeyGrain.THREAD, LOCATOR) is None


def test_incomplete_locator_raises_rather_than_forking(capabilities):
    with pytest.raises(ChannelLocatorIncomplete) as caught:
        compose_external_key(
            capabilities,
            ChannelKeyGrain.THREAD,
            {"team": "T1", "channel": "C1"},
        )

    assert caught.value.missing == "thread_ts"


def test_outbox_key_is_stable_and_idempotency_key_moves(capabilities):
    from datetime import datetime, timezone

    thread_id = uuid4()
    key = compose_outbox_key(thread_id=thread_id, turn_id="turn-1", item=0)

    assert key == compose_outbox_key(thread_id=thread_id, turn_id="turn-1", item=0)
    assert key != compose_outbox_key(thread_id=thread_id, turn_id="turn-1", item=1)

    first = datetime(2026, 1, 1, tzinfo=timezone.utc)
    later = datetime(2026, 1, 2, tzinfo=timezone.utc)

    assert compose_idempotency_key(key=key, updated_at=first) == (
        compose_idempotency_key(key=key, updated_at=first)
    )
    assert compose_idempotency_key(key=key, updated_at=first) != (
        compose_idempotency_key(key=key, updated_at=later)
    )


def test_entities_instantiate():
    connection_id, space_id, agent_id = uuid4(), uuid4(), uuid4()

    agent = ChannelAgent(
        id=agent_id,
        slug="support-agent",
        connection_id=connection_id,
        data=ChannelAgentData(references={}),
    )
    space = ChannelSpace(
        id=space_id,
        connection_id=connection_id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
    )
    grant = ChannelGrant(
        id=uuid4(),
        agent_id=agent_id,
        space_id=space_id,
        data=ChannelGrantData(),
    )
    thread = ChannelThread(
        id=uuid4(),
        space_id=space_id,
        agent_id=agent_id,
        external_key=uuid4(),
        session_id="session-1",
        data=ChannelThreadData(external_locator=LOCATOR),
    )
    event = ChannelInboxEvent(
        id=uuid4(),
        connection_id=connection_id,
        external_id="Ev123",
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        space_id=space_id,
        data=ChannelInboxEventData(
            external_locator=LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": "~agent hello"}],
                sender={"id": "U1"},
            ),
        ),
    )
    trigger = ChannelInboxTrigger(
        id=uuid4(),
        thread_id=thread.id,
        event_id=event.id,
        turn_id="turn-1",
        state=ChannelTriggerState.STARTED,
    )
    outbox = ChannelOutboxEvent(
        id=uuid4(),
        connection_id=connection_id,
        thread_id=thread.id,
        turn_id="turn-1",
        key=uuid4(),
        state=ChannelDeliveryState.CREATED,
        data=ChannelOutboxEventData(),
    )
    candidate = ChannelSpaceCandidate(
        kind=ChannelSpaceKind.TOPIC,
        external_locator={"team": "T1", "channel": "C2"},
        display_name="#engineering",
    )
    inbound = ChannelInboundEvent(
        external_id="Ev123",
        kind=ChannelEventKind.MESSAGE,
        space_kind=ChannelSpaceKind.TOPIC,
        external_locator=LOCATOR,
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": "hi"}], sender={"id": "U1"}
        ),
        addressed=True,
    )

    assert agent.flags.is_active and not agent.flags.is_default
    assert not space.flags.is_backfilled
    assert not grant.flags.is_default
    assert thread.flags.is_active
    assert event.status is None
    assert not trigger.flags.is_backfilled
    assert outbox.data.external_locator is None
    assert not candidate.is_configured
    assert inbound.origin == ChannelEventOrigin.PUSHED


def test_slug_validator_is_enforced():
    with pytest.raises(ValueError):
        ChannelAgent(
            id=uuid4(),
            slug="not a slug!",
            connection_id=uuid4(),
            data=ChannelAgentData(references={}),
        )


def test_ports_are_abstract():
    assert ChannelsDAOInterface.__abstractmethods__
    assert set(ChannelAdapterInterface.__abstractmethods__) == {
        "fetch_capabilities",
        "connection_locator",
        "verify_signature",
        "parse_event",
        "post_message",
        "edit_message",
        "discover_spaces",
        "fetch_history",
    }

    with pytest.raises(TypeError):
        ChannelAdapterInterface()
