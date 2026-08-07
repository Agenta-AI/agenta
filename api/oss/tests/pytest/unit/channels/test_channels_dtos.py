"""DTO instantiation: every entity's Create/Edit/Query variant, not just the
entity itself (test_channels_seed.py already covers the entities and the
capability declaration)."""

from uuid import uuid4

from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEdit,
    ChannelGrantQuery,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxEventQuery,
    ChannelInboxTriggerCreate,
    ChannelInboxTriggerQuery,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelOutboxEventQuery,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceEdit,
    ChannelSpaceKind,
    ChannelSpaceQuery,
    ChannelThreadCreate,
    ChannelThreadData,
    ChannelThreadQuery,
    ChannelTriggerState,
)


LOCATOR = {"team": "T1", "channel": "C1"}


def test_agent_variants_instantiate():
    connection_id = uuid4()

    ChannelAgentCreate(
        connection_id=connection_id,
        slug="support",
        data=ChannelAgentData(references={}),
    )
    ChannelAgentEdit(id=uuid4(), data=ChannelAgentData(references={}))
    ChannelAgentQuery(connection_id=connection_id, slug="support")


def test_space_variants_instantiate():
    connection_id = uuid4()

    ChannelSpaceCreate(
        connection_id=connection_id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator=LOCATOR),
    )
    ChannelSpaceEdit(id=uuid4(), data=ChannelSpaceData(external_locator=LOCATOR))
    ChannelSpaceQuery(connection_id=connection_id, kind=ChannelSpaceKind.TOPIC)
    ChannelSpaceCandidate(kind=ChannelSpaceKind.TOPIC, external_locator=LOCATOR)


def test_grant_variants_instantiate():
    agent_id, space_id = uuid4(), uuid4()

    ChannelGrantCreate(agent_id=agent_id, space_id=space_id, data=ChannelGrantData())
    ChannelGrantEdit(id=uuid4(), data=ChannelGrantData())
    ChannelGrantQuery(agent_id=agent_id, space_id=space_id)


def test_thread_variants_instantiate():
    space_id, agent_id = uuid4(), uuid4()

    ChannelThreadCreate(
        space_id=space_id,
        agent_id=agent_id,
        session_id="session-1",
        data=ChannelThreadData(),
    )
    ChannelThreadQuery(space_id=space_id, agent_id=agent_id, session_id="session-1")


def test_inbox_event_variants_instantiate():
    connection_id, space_id = uuid4(), uuid4()

    ChannelInboxEventCreate(
        connection_id=connection_id,
        external_id="Ev1",
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        space_id=space_id,
        data=ChannelInboxEventData(
            external_locator=LOCATOR,
            processed=ChannelInboxEventProcessed(content=[], sender={}),
        ),
    )
    ChannelInboxEventQuery(connection_id=connection_id, space_id=space_id)


def test_inbox_trigger_variants_instantiate():
    thread_id, event_id = uuid4(), uuid4()

    ChannelInboxTriggerCreate(thread_id=thread_id, event_id=event_id, turn_id="turn-1")
    ChannelInboxTriggerQuery(thread_id=thread_id, state=ChannelTriggerState.STARTED)


def test_outbox_event_variants_instantiate():
    connection_id, thread_id = uuid4(), uuid4()

    ChannelOutboxEventCreate(
        connection_id=connection_id,
        thread_id=thread_id,
        turn_id="turn-1",
        key=uuid4(),
        data=ChannelOutboxEventData(),
    )
    ChannelOutboxEventQuery(thread_id=thread_id, state=ChannelDeliveryState.CREATED)
