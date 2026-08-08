"""Integration tests for `ChannelsService.resolve`/`compose_input`/
`open_turn`/`settle_turn` against real Postgres — the routing methods that
resolve an inbound event to an agent, space, and thread. Exercises the real
`ChannelsDAO` so the DAO-layer contracts (`ON CONFLICT DO NOTHING` on both
`channel_spaces.external_key` lookup and `record_inbox_trigger`'s dedup) are
load-bearing, not assumed. Uses the same `channels_scope` fixture the other
channels DAO integration tests use.
"""

import uuid

import pytest
from sqlalchemy import select

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelTriggerState,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.gateway.connections.dtos import Connection
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE

from oss.tests.pytest.unit.channels.contract.fakes import WellBehavedFakeAdapter


pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


class _FakeConnectionsService:
    """Stands in for `ConnectionsService`: the real `get_connection` is a
    thin DAO passthrough; this returns the fixture's own
    `gateway_connections` row shape without a second DB round trip."""

    def __init__(self, *, connection):
        self._connection = connection

    async def get_connection(self, *, project_id, connection_id):
        if connection_id != self._connection.id:
            return None
        return self._connection


async def _make_service(channels_scope, *, adapter):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    registry = ChannelAdapterRegistry(adapters={"slack": adapter})

    async with channels_scope["engine"].session() as session:
        result = await session.execute(
            select(ConnectionDBE).where(
                ConnectionDBE.id == channels_scope["connection_id"]
            )
        )
        connection_dbe = result.scalar_one()

    connection = Connection(
        id=connection_dbe.id,
        slug=connection_dbe.slug,
        provider_key=connection_dbe.provider_key,
        integration_key=connection_dbe.integration_key,
    )

    connections_service = _FakeConnectionsService(connection=connection)

    return ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
        connections_service=connections_service,
    ), dao


async def _make_configured_space(dao, *, project_id, connection_id, adapter):
    capabilities = await adapter.fetch_capabilities()
    external_key = compose_external_key(capabilities, ChannelKeyGrain.SPACE, LOCATOR)
    return await dao.create_space(
        project_id=project_id,
        user_id=uuid.uuid4(),
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.GROUP,
            external_key=external_key,
            data=ChannelSpaceData(external_locator=LOCATOR),
        ),
    )


async def _make_inbox_event(dao, *, project_id, connection_id, external_id, text):
    return await dao.record_inbox_event(
        project_id=project_id,
        event=ChannelInboxEventCreate(
            connection_id=connection_id,
            external_id=external_id,
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=LOCATOR,
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": text}],
                    sender={"id": "U1"},
                ),
            ),
        ),
    )


async def test_resolve_unconfigured_space_returns_none(channels_scope):
    """No `channel_spaces` row for this connection+key -> default-deny."""

    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)

    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-unconfigured",
        text="~triage hello",
    )

    result = await service.resolve(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )

    assert result is None


async def test_resolve_sigil_creates_thread_and_open_turn_writes_started_row(
    channels_scope,
):
    """End to end against real Postgres: a configured space, an agent named
    by sigil, no grants (unrestricted) -> resolve() returns a Resolution;
    open_turn() writes the trigger row at STARTED."""

    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)

    space = await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )
    agent = await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )

    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-sigil",
        text="~triage please deploy",
    )

    resolution = await service.resolve(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )

    assert resolution is not None
    assert resolution.agent.id == agent.id
    assert resolution.space.id == space.id

    turn_input = await service.compose_input(
        project_id=channels_scope["project_id"],
        resolution=resolution,
        event_id=event.id,
    )
    assert turn_input.content == event.data.processed.content

    trigger = await service.open_turn(
        project_id=channels_scope["project_id"],
        resolution=resolution,
        turn_id="turn-1",
        event_id=event.id,
    )

    assert trigger is not None
    assert trigger.state == ChannelTriggerState.STARTED
    assert trigger.event_id == event.id
    assert trigger.thread_id == resolution.thread.id

    await service.settle_turn(
        project_id=channels_scope["project_id"],
        trigger_id=trigger.id,
        state=ChannelTriggerState.SETTLED,
    )

    rows = await dao.query_inbox_triggers(project_id=channels_scope["project_id"])
    assert len(rows) == 1
    assert rows[0].state == ChannelTriggerState.SETTLED


async def test_open_turn_second_worker_loses_the_race(channels_scope):
    """Two workers racing the exact same addressing collide on
    `(thread_id, event_id)`; the DAO's `ON CONFLICT DO NOTHING` means the
    second `open_turn` call returns None and must not invoke."""

    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)

    await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )
    await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )
    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-race",
        text="~triage race me",
    )

    resolution = await service.resolve(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )
    assert resolution is not None

    first = await service.open_turn(
        project_id=channels_scope["project_id"],
        resolution=resolution,
        turn_id="turn-a",
        event_id=event.id,
    )
    second = await service.open_turn(
        project_id=channels_scope["project_id"],
        resolution=resolution,
        turn_id="turn-b",
        event_id=event.id,
    )

    assert first is not None
    assert second is None

    rows = await dao.query_inbox_triggers(project_id=channels_scope["project_id"])
    assert len(rows) == 1
    assert rows[0].turn_id == "turn-a"


async def test_grant_restricted_agent_not_in_this_space_refuses(channels_scope):
    """The agent has grants rows (restricted), but none for this
    space -> resolve() returns None, identically to an unknown agent."""

    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)

    await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )
    agent = await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )

    # a grant exists, but for a DIFFERENT space than the one being addressed
    other_space = await dao.create_space(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        space=ChannelSpaceCreate(
            connection_id=channels_scope["connection_id"],
            kind=ChannelSpaceKind.GROUP,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C2"}),
        ),
    )
    await dao.create_grant(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            space_id=other_space.id,
            data=ChannelGrantData(),
        ),
    )

    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-restricted",
        text="~triage not granted here",
    )

    result = await service.resolve(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )

    assert result is None


async def test_resolve_attaches_the_event_to_its_space(channels_scope):
    """The ingress writes an event before any space is resolved, so
    `space_id` starts null. `compose_input` reads the log *by* `space_id`
    (`ix_channel_inbox_events_log` is keyed on it), so an unattached row is
    invisible and the agent is invoked with empty content. resolve() closes that
    gap; this pins the mechanism, not just the symptom.
    """

    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)

    space = await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )
    await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )

    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-attach",
        text="~triage attach me",
    )
    assert event.space_id is None  # the ingress could not know it

    resolution = await service.resolve(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )
    assert resolution is not None

    events = await dao.query_events_since(
        project_id=channels_scope["project_id"],
        space_id=space.id,
        after_event_id=None,
    )
    assert [stored.id for stored in events] == [event.id]


async def test_attaching_the_same_event_twice_is_idempotent(channels_scope):
    """A platform redelivery re-resolves the same space; the second attach must
    be a no-op rather than a second row or a thrashed timestamp."""

    adapter = WellBehavedFakeAdapter()
    _, dao = await _make_service(channels_scope, adapter=adapter)

    space = await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )

    event = await _make_inbox_event(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_id="ev-idempotent",
        text="~triage twice",
    )

    first = await dao.attach_event_to_space(
        project_id=channels_scope["project_id"],
        event_id=event.id,
        space_id=space.id,
    )
    second = await dao.attach_event_to_space(
        project_id=channels_scope["project_id"],
        event_id=event.id,
        space_id=space.id,
    )

    assert first.space_id == space.id
    assert second.space_id == space.id
    assert second.updated_at == first.updated_at  # no write on the second call

    events = await dao.query_events_since(
        project_id=channels_scope["project_id"],
        space_id=space.id,
        after_event_id=None,
    )
    assert [stored.id for stored in events].count(event.id) == 1
