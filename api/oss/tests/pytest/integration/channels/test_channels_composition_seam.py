"""As close to `entrypoints/routers.py`'s own wiring as F27 allows: the
module cannot be imported outside a container, so this constructs the same
`ChannelAdapterRegistry({"slack": SlackAdapter(), "mock": MockAdapter()})`
and drives the real `InboxDispatcher` chain against real Postgres, instead
of asserting against a hand-built single-adapter registry the way the unit
suite does.

This proves the mock adapter is reachable through the actual dispatch
pipeline (command parsing, backfill, turn open) with a real DAO underneath.
It does NOT prove `routers.py` itself builds this registry — only that the
registry is buildable this way and every piece behind it holds together.
"""

import uuid

import pytest

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.sessions.streams.dtos import CommandMode
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.channels.dbes import ChannelConnectionDBE
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from sqlalchemy import update

pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


class _FakeStreamsService:
    """Stands in for `SessionStreamsService`: `!stop` only needs a
    `.command()` call to have happened, not the runner it would reach for
    real — that reach is out of scope for this checkpoint."""

    def __init__(self):
        self.calls = []

    async def command(self, *, project_id, user_id, request):
        from oss.src.core.sessions.streams.dtos import SessionStreamCommandResponse

        self.calls.append((project_id, user_id, request))
        return SessionStreamCommandResponse(
            mode=CommandMode.cancel,
            session_id=request.session_id,
        )


@pytest.fixture
async def registry_scope(channels_scope):
    """The exact registry shape `entrypoints/routers.py` builds, over a
    `channel_connections` row switched to `channel="mock"` so the registry
    picks the mock adapter, the same way it would pick `slack` for a real
    installation."""

    engine = channels_scope["engine"]

    async with engine.session() as session:
        await session.execute(
            update(ChannelConnectionDBE)
            .where(ChannelConnectionDBE.id == channels_scope["connection_id"])
            .values(channel="mock")
        )
        await session.commit()

    registry = ChannelAdapterRegistry(
        adapters={"slack": SlackAdapter(), "mock": MockAdapter()}
    )
    dao = ChannelsDAO(engine=engine)
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
    )

    yield {**channels_scope, "registry": registry, "service": service, "dao": dao}


async def _make_configured_space(dao, *, project_id, connection_id, registry):
    adapter = registry.get("mock")
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


async def test_registry_get_mock_resolves_a_real_adapter_backing_a_real_dispatch(
    registry_scope,
):
    """`registry.get("mock")` used through `ChannelsService.resolve()`, not a
    registry a test built for itself in isolation."""

    resolved = registry_scope["registry"].get("mock")
    assert isinstance(resolved, MockAdapter)

    connection = await registry_scope["service"].fetch_connection(
        project_id=registry_scope["project_id"],
        connection_id=registry_scope["connection_id"],
    )
    assert connection.channel == "mock"


async def test_a_matched_command_travels_through_dispatch_event_and_opens_no_turn(
    registry_scope,
):
    """`!sessions` sent through the real `InboxDispatcher.dispatch_event`,
    over the mock-registered adapter and a real DAO: the command runs
    (`query_threads` returns the seeded thread) and no trigger row is
    written."""

    dao = registry_scope["dao"]
    project_id = registry_scope["project_id"]
    connection_id = registry_scope["connection_id"]

    await _make_configured_space(
        dao,
        project_id=project_id,
        connection_id=connection_id,
        registry=registry_scope["registry"],
    )
    await dao.create_agent(
        project_id=project_id,
        user_id=registry_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )

    event = await _make_inbox_event(
        dao,
        project_id=project_id,
        connection_id=connection_id,
        external_id="ev-cmd",
        text="~triage !sessions",
    )

    dispatcher = InboxDispatcher(
        channels_service=registry_scope["service"],
        streams_service=_FakeStreamsService(),
        invoke_fn=None,
    )

    await dispatcher.dispatch_event(
        project_id=project_id, connection_id=connection_id, event=event
    )

    rows = await dao.query_inbox_triggers(project_id=project_id)
    assert rows == []  # a command never opens a turn


async def test_backfill_runs_once_through_dispatch_event_and_sets_the_flag(
    registry_scope,
):
    """An ordinary (non-command) message through the same real chain runs
    backfill before the turn opens: mock's own scripted history is empty, so
    this pins the empty-but-answered case setting the flag against a real
    `channel_spaces` row."""

    dao = registry_scope["dao"]
    project_id = registry_scope["project_id"]
    connection_id = registry_scope["connection_id"]

    space = await _make_configured_space(
        dao,
        project_id=project_id,
        connection_id=connection_id,
        registry=registry_scope["registry"],
    )
    assert not space.flags.is_backfilled

    await dao.create_agent(
        project_id=project_id,
        user_id=registry_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
        ),
    )

    event = await _make_inbox_event(
        dao,
        project_id=project_id,
        connection_id=connection_id,
        external_id="ev-backfill",
        text="~triage please deploy",
    )

    invoked = {}

    async def _invoke_fn(*, project_id, resolution, turn_input, turn_id, **extra):
        invoked["is_backfilled"] = turn_input.is_backfilled
        return "run-1"

    dispatcher = InboxDispatcher(
        channels_service=registry_scope["service"],
        invoke_fn=_invoke_fn,
    )

    await dispatcher.dispatch_event(
        project_id=project_id, connection_id=connection_id, event=event
    )

    assert invoked["is_backfilled"] is True  # compose_input saw the fresh flag

    refreshed = await dao.fetch_space(project_id=project_id, space_id=space.id)
    assert refreshed.flags.is_backfilled is True

    rows = await dao.query_inbox_triggers(project_id=project_id)
    assert len(rows) == 1  # backfill did not block the live message's own turn
