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

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelTriggerState,
    CHANNEL_TRIGGER_NEVER_SENT,
)
from oss.src.core.shared.dtos import Status
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

from oss.tests.pytest.unit.channels.contract.fakes import WellBehavedFakeAdapter


pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


async def _make_service(channels_scope, *, adapter):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    registry = ChannelAdapterRegistry(adapters={"slack": adapter})

    return ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
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


async def _make_inbox_event(
    dao, *, project_id, connection_id, external_id, text, addressed=None
):
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
                addressed=addressed,
            ),
        ),
    )


async def test_resolve_unconfigured_space_is_created_not_refused(channels_scope):
    """No `channel_spaces` row for this connection+key -> get_or_create_space
    writes one on first contact; the addressed agent still does not exist,
    so resolve() still returns None, but via the agent lookup, not a
    default-deny gate on the space's absence."""

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

    capabilities = await adapter.fetch_capabilities()
    external_key = compose_external_key(capabilities, ChannelKeyGrain.SPACE, LOCATOR)
    created_space = await dao.fetch_space_by_key(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        external_key=external_key,
    )
    assert created_space is not None


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
    # compose_input puts a "From <who>" attribution part before each message
    assert turn_input.content[-1:] == event.data.processed.content
    assert turn_input.content[0]["text"].startswith("From ")

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
            effect=ChannelGrantEffect.ALLOW,
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


class _Thread:
    """One Slack channel thread driven through the worker's own sequence
    against real Postgres: record the event, resolve, then compose_input,
    open_turn and settle_turn when it opens a turn."""

    def __init__(self, channels_scope, service, dao, space=None):
        self.space = space
        self.scope = channels_scope
        self.service = service
        self.dao = dao
        self.count = 0

    async def store(self, text, *, addressed=False):
        """What the ingress and the start of `resolve` do: log the arrival
        and attach it to its space, without dispatching a turn."""
        self.count += 1
        event = await _make_inbox_event(
            self.dao,
            project_id=self.scope["project_id"],
            connection_id=self.scope["connection_id"],
            external_id=f"ev-{self.count}",
            text=text,
            addressed=addressed or None,
        )
        space = await self.dao.fetch_space_by_key(
            project_id=self.scope["project_id"],
            connection_id=self.scope["connection_id"],
            external_key=self.space.external_key,
        )
        await self.dao.attach_event_to_space(
            project_id=self.scope["project_id"], event_id=event.id, space_id=space.id
        )
        return event

    async def resolve(self, event):
        return await self.service.resolve(
            project_id=self.scope["project_id"],
            connection_id=self.scope["connection_id"],
            event=event,
        )

    async def compose(self, resolution, event):
        turn_input = await self.service.compose_input(
            project_id=self.scope["project_id"],
            resolution=resolution,
            event_id=event.id,
        )
        if turn_input is None:
            return None
        return _words(turn_input)

    async def open_and_settle(self, resolution, event, *, settle, code=None):
        trigger = await self.service.open_turn(
            project_id=self.scope["project_id"],
            resolution=resolution,
            turn_id=f"turn-{event.id}",
            event_id=event.id,
        )
        await self.service.settle_turn(
            project_id=self.scope["project_id"],
            trigger_id=trigger.id,
            state=settle,
            status=Status(code=code) if code is not None else None,
        )

    async def post(
        self, text, *, addressed=False, settle=ChannelTriggerState.SETTLED, code=None
    ):
        self.count += 1
        event = await _make_inbox_event(
            self.dao,
            project_id=self.scope["project_id"],
            connection_id=self.scope["connection_id"],
            external_id=f"ev-{self.count}",
            text=text,
            addressed=addressed or None,
        )
        resolution = await self.service.resolve(
            project_id=self.scope["project_id"],
            connection_id=self.scope["connection_id"],
            event=event,
        )
        if resolution is None:
            return None
        turn_input = await self.service.compose_input(
            project_id=self.scope["project_id"],
            resolution=resolution,
            event_id=event.id,
        )
        trigger = await self.service.open_turn(
            project_id=self.scope["project_id"],
            resolution=resolution,
            turn_id=f"turn-{self.count}",
            event_id=event.id,
        )
        await self.service.settle_turn(
            project_id=self.scope["project_id"],
            trigger_id=trigger.id,
            state=settle,
            status=Status(code=code) if code is not None else None,
        )
        return [
            part["text"]
            for part in turn_input.content
            if not part["text"].startswith("From ")
        ]


async def _mention_only_thread(channels_scope):
    adapter = WellBehavedFakeAdapter()
    service, dao = await _make_service(channels_scope, adapter=adapter)
    space = await _make_configured_space(
        dao,
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        adapter=adapter,
    )
    # the room's default agent, so a plain message reaches the trigger gate
    # instead of being dropped for having no agent
    await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid.uuid4())}}
            ),
            flags=ChannelAgentFlags(is_default=True),
        ),
    )
    return _Thread(channels_scope, service, dao, space)


async def test_each_mention_receives_exactly_the_messages_since_the_last_turn(
    channels_scope,
):
    """Mahmoud's spec (2026-09-24), against real Postgres: M1, five
    unaddressed messages, M2, three unaddressed messages, M3. M2's turn gets
    the five plus M2; M3's turn gets the three plus M3 and nothing earlier."""

    thread = await _mention_only_thread(channels_scope)

    first = await thread.post("M1", addressed=True)
    for index in range(1, 6):
        assert await thread.post(f"a{index}") is None
    second = await thread.post("M2", addressed=True)
    for index in range(1, 4):
        assert await thread.post(f"b{index}") is None
    third = await thread.post("M3", addressed=True)

    assert first == ["M1"]
    assert second == ["a1", "a2", "a3", "a4", "a5", "M2"]
    assert third == ["b1", "b2", "b3", "M3"]

    triggers = await thread.dao.query_inbox_triggers(
        project_id=channels_scope["project_id"]
    )
    assert len(triggers) == 3


def _words(turn_input):
    return [
        part["text"]
        for part in turn_input.content
        if not part["text"].startswith("From ")
    ]


@pytest.mark.parametrize(
    "fate,code",
    [
        (ChannelTriggerState.REFUSED, "409"),
        (ChannelTriggerState.FAILED, CHANNEL_TRIGGER_NEVER_SENT),
    ],
)
async def test_a_turn_that_never_ran_leaves_its_context_for_the_next(
    channels_scope, fate, code
):
    thread = await _mention_only_thread(channels_scope)

    assert await thread.post("M1", addressed=True) == ["M1"]
    assert await thread.post("before the failure") is None
    assert await thread.post("M2", addressed=True, settle=fate, code=code) == [
        "before the failure",
        "M2",
    ]
    assert await thread.post("after the failure") is None
    third = await thread.post("M3", addressed=True)

    assert third == ["before the failure", "M2", "after the failure", "M3"]


async def test_a_failure_that_may_have_run_is_not_replayed(channels_scope):
    """A lost response after the POST landed: the turn may have run, so M3
    must not send M2's messages again."""
    thread = await _mention_only_thread(channels_scope)

    await thread.post("M1", addressed=True)
    await thread.post("a")
    await thread.post(
        "M2", addressed=True, settle=ChannelTriggerState.FAILED, code="500"
    )
    await thread.post("b")

    assert await thread.post("M3", addressed=True) == ["b", "M3"]


async def test_a_message_stored_after_the_mention_waits_for_the_next_turn(
    channels_scope,
):
    """Codex's repro against Postgres: `b` lands between M2's resolve and its
    compose."""
    thread = await _mention_only_thread(channels_scope)
    await thread.post("M1", addressed=True)

    await thread.store("a")
    m2 = await thread.store("M2", addressed=True)
    resolution = await thread.resolve(m2)
    await thread.store("b")
    second = await thread.compose(resolution, m2)
    await thread.open_and_settle(resolution, m2, settle=ChannelTriggerState.SETTLED)

    assert second == ["a", "M2"]
    assert await thread.post("M3", addressed=True) == ["b", "M3"]


async def test_a_later_mention_composed_first_does_not_swallow_the_earlier(
    channels_scope,
):
    thread = await _mention_only_thread(channels_scope)
    await thread.post("M1", addressed=True)

    await thread.store("a")
    m2 = await thread.store("M2", addressed=True)
    await thread.store("b")
    m3 = await thread.store("M3", addressed=True)
    r2 = await thread.resolve(m2)
    r3 = await thread.resolve(m3)

    third = await thread.compose(r3, m3)
    await thread.open_and_settle(r3, m3, settle=ChannelTriggerState.SETTLED)
    second = await thread.compose(r2, m2)
    await thread.open_and_settle(r2, m2, settle=ChannelTriggerState.SETTLED)

    # both mentions run; `a` reaches both turns (the documented repeat)
    assert third == ["a", "M2", "b", "M3"]
    assert second == ["a", "M2"]
    assert await thread.post("M4", addressed=True) == ["M4"]


async def test_a_consumed_answer_is_not_composed_into_the_next_turn(
    channels_scope,
):
    thread = await _mention_only_thread(channels_scope)
    await thread.post("M1", addressed=True)

    await thread.store("side note")
    answer = await thread.store("Approve")
    await thread.dao.mark_inbox_event_consumed(
        project_id=channels_scope["project_id"], event_id=answer.id
    )
    await thread.store("after")

    assert await thread.post("M2", addressed=True) == ["side note", "after", "M2"]


class _Runner:
    def __init__(self):
        self.sent = []

    async def invoke(self, *, project_id, resolution, turn_input, turn_id, **extra):
        self.sent.append(_words(turn_input))
        return turn_id


async def _dispatch(thread, dispatcher, event):
    from oss.src.core.channels.dtos import ChannelInboxEventQuery

    [stored] = await thread.dao.query_inbox_events(
        project_id=thread.scope["project_id"],
        event=ChannelInboxEventQuery(
            connection_id=thread.scope["connection_id"],
            external_id=event.external_id,
        ),
    )
    await dispatcher.dispatch_event(
        project_id=thread.scope["project_id"],
        connection_id=thread.scope["connection_id"],
        event=stored,
    )


async def _log(thread, text, *, addressed=False):
    """What the ingress does: record the arrival, nothing attached yet."""
    thread.count += 1
    return await _make_inbox_event(
        thread.dao,
        project_id=thread.scope["project_id"],
        connection_id=thread.scope["connection_id"],
        external_id=f"ev-{thread.count}",
        text=text,
        addressed=addressed or None,
    )


def _dispatcher(thread, runner):
    from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

    return InboxDispatcher(channels_service=thread.service, invoke_fn=runner.invoke)


async def test_two_mentions_dispatched_at_once_each_run_once(
    channels_scope,
):
    """Real concurrent dispatches on one thread, one of them redelivered."""
    import asyncio

    thread = await _mention_only_thread(channels_scope)
    runner = _Runner()
    dispatcher = _dispatcher(thread, runner)
    await _dispatch(thread, dispatcher, await _log(thread, "M1", addressed=True))

    events = [
        await _log(thread, "a"),
        await _log(thread, "M2", addressed=True),
        await _log(thread, "b"),
        await _log(thread, "M3", addressed=True),
    ]
    await asyncio.gather(
        *(_dispatch(thread, dispatcher, event) for event in [*events, events[1]])
    )

    # each mention runs exactly once; context may repeat (documented limit)
    assert sorted(turn[-1] for turn in runner.sent) == ["M1", "M2", "M3"]


async def test_an_earlier_mention_dispatched_late_still_runs(channels_scope):
    """Codex's repro against Postgres: M3 is dispatched before M2, `a` and
    `b` were attached. M2 used to vanish; now nothing skips a mention."""
    thread = await _mention_only_thread(channels_scope)
    runner = _Runner()
    dispatcher = _dispatcher(thread, runner)
    await _dispatch(thread, dispatcher, await _log(thread, "M1", addressed=True))

    a = await _log(thread, "a")
    m2 = await _log(thread, "M2", addressed=True)
    b = await _log(thread, "b")
    m3 = await _log(thread, "M3", addressed=True)
    for event in (m3, m2, a, b):
        await _dispatch(thread, dispatcher, event)
    await _dispatch(thread, dispatcher, await _log(thread, "M4", addressed=True))

    assert [turn[-1] for turn in runner.sent] == ["M1", "M3", "M2", "M4"]


async def test_a_mention_delayed_for_hours_still_runs(channels_scope):
    """Codex's third review against Postgres: after a backlog, M2 is hours
    old and undispatched when M3 runs. It still gets its own turn."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text as sql

    thread = await _mention_only_thread(channels_scope)
    runner = _Runner()
    dispatcher = _dispatcher(thread, runner)
    await _dispatch(thread, dispatcher, await _log(thread, "M1", addressed=True))

    m2 = await _log(thread, "M2", addressed=True)
    async with channels_scope["engine"].session() as session:
        await session.execute(
            sql("UPDATE channel_inbox_events SET created_at = :at WHERE id = :id"),
            {"at": datetime.now(timezone.utc) - timedelta(hours=3), "id": m2.id},
        )
    m3 = await _log(thread, "M3", addressed=True)
    await _dispatch(thread, dispatcher, m3)
    await _dispatch(thread, dispatcher, m2)

    assert [turn[-1] for turn in runner.sent] == ["M1", "M3", "M2"]
