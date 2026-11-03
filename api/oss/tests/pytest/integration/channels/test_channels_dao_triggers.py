import pytest

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTriggerCreate,
    ChannelTriggerState,
    CHANNEL_TRIGGER_NEVER_SENT,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.channels.dao import ChannelsDAO


pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1"}


async def _make_event(dao, *, project_id, connection_id, external_id):
    return await dao.record_inbox_event(
        project_id=project_id,
        event=ChannelInboxEventCreate(
            connection_id=connection_id,
            external_id=external_id,
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=LOCATOR,
                processed=ChannelInboxEventProcessed(content=[], sender={"id": "U1"}),
            ),
        ),
    )


async def test_fetch_latest_trigger_is_none_when_never_addressed(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    import uuid

    result = await dao.fetch_latest_trigger(
        project_id=channels_scope["project_id"], thread_id=uuid.uuid4()
    )

    assert result is None


async def test_record_inbox_trigger_dedups_on_thread_and_event(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    event = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="Ev1"
    )
    import uuid

    thread_id = uuid.uuid4()

    first = await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event.id, turn_id="turn-1"
        ),
    )
    second = await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event.id, turn_id="turn-2"
        ),
    )

    assert first is not None
    assert second is None

    rows = await dao.query_inbox_triggers(project_id=project_id)
    assert len(rows) == 1
    assert rows[0].turn_id == "turn-1"


async def test_fetch_latest_trigger_returns_the_most_recent_row(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    import uuid

    thread_id = uuid.uuid4()

    event_a = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="EvA"
    )
    event_b = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="EvB"
    )

    await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event_a.id, turn_id="turn-a"
        ),
    )
    latest = await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event_b.id, turn_id="turn-b"
        ),
    )

    fetched = await dao.fetch_latest_trigger(project_id=project_id, thread_id=thread_id)

    assert fetched is not None
    assert fetched.id == latest.id
    assert fetched.turn_id == "turn-b"


async def test_transition_inbox_trigger_updates_in_place(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    import uuid

    thread_id = uuid.uuid4()

    event = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="Ev1"
    )
    created = await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event.id, turn_id="turn-1"
        ),
    )

    updated = await dao.transition_inbox_trigger(
        project_id=project_id,
        trigger_id=created.id,
        state=ChannelTriggerState.SETTLED,
        status=Status(type="ok", code="200"),
    )

    assert updated is not None
    assert updated.id == created.id
    assert updated.state == ChannelTriggerState.SETTLED
    assert updated.status is not None
    assert updated.status.code == "200"

    rows = await dao.query_inbox_triggers(project_id=project_id)
    assert len(rows) == 1


async def _trigger(dao, *, project_id, thread_id, event, turn_id, state, code=None):
    created = await dao.record_inbox_trigger(
        project_id=project_id,
        trigger=ChannelInboxTriggerCreate(
            thread_id=thread_id, event_id=event.id, turn_id=turn_id
        ),
    )
    if state is not ChannelTriggerState.STARTED:
        await dao.transition_inbox_trigger(
            project_id=project_id,
            trigger_id=created.id,
            state=state,
            status=Status(code=code) if code is not None else None,
        )
    return created


@pytest.mark.parametrize(
    "fate,code",
    [
        (ChannelTriggerState.REFUSED, "409"),
        (ChannelTriggerState.FAILED, CHANNEL_TRIGGER_NEVER_SENT),
    ],
)
async def test_fetch_latest_trigger_skips_a_turn_that_never_ran(
    channels_scope, fate, code
):
    """A REFUSED turn, or a FAILED one whose start never reached the workflow
    service, never reached the agent: the offset stays at the turn before."""
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    import uuid

    thread_id = uuid.uuid4()
    settled_event = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="EvS"
    )
    failed_event = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="EvF"
    )
    settled = await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=settled_event,
        turn_id="turn-s",
        state=ChannelTriggerState.SETTLED,
    )
    failed = await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=failed_event,
        turn_id="turn-f",
        state=ChannelTriggerState.STARTED,
    )

    # while it is still STARTED, the newer trigger is the offset
    fetched = await dao.fetch_latest_trigger(project_id=project_id, thread_id=thread_id)
    assert fetched.id == failed.id

    await dao.transition_inbox_trigger(
        project_id=project_id,
        trigger_id=failed.id,
        state=fate,
        status=Status(code=code),
    )

    fetched = await dao.fetch_latest_trigger(project_id=project_id, thread_id=thread_id)
    assert fetched is not None
    assert fetched.id == settled.id


@pytest.mark.parametrize("code", ["500", None])
async def test_fetch_latest_trigger_counts_a_failure_that_may_have_run(
    channels_scope, code
):
    """A FAILED turn without the never-sent code (a response lost after the
    POST landed, or no status at all) may have run, so it is the offset."""
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    import uuid

    thread_id = uuid.uuid4()
    first = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="Ev1"
    )
    second = await _make_event(
        dao, project_id=project_id, connection_id=connection_id, external_id="Ev2"
    )
    await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=first,
        turn_id="turn-1",
        state=ChannelTriggerState.SETTLED,
    )
    failed = await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=second,
        turn_id="turn-2",
        state=ChannelTriggerState.FAILED,
        code=code,
    )

    fetched = await dao.fetch_latest_trigger(project_id=project_id, thread_id=thread_id)

    assert fetched.id == failed.id


async def test_fetch_latest_trigger_orders_by_event_and_bounds_before_it(
    channels_scope,
):
    """Two turns can record their triggers out of order. The offset is the
    latest EVENT, and `before_event_id` gives the offset for an earlier one."""
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    import uuid

    thread_id = uuid.uuid4()
    first, second, third = [
        await _make_event(
            dao, project_id=project_id, connection_id=connection_id, external_id=name
        )
        for name in ("Ev1", "Ev2", "Ev3")
    ]
    on_first = await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=first,
        turn_id="turn-1",
        state=ChannelTriggerState.SETTLED,
    )
    on_third = await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=third,
        turn_id="turn-3",
        state=ChannelTriggerState.SETTLED,
    )
    # recorded last, on an earlier event
    await _trigger(
        dao,
        project_id=project_id,
        thread_id=thread_id,
        event=second,
        turn_id="turn-2",
        state=ChannelTriggerState.SETTLED,
    )

    latest = await dao.fetch_latest_trigger(project_id=project_id, thread_id=thread_id)
    before_second = await dao.fetch_latest_trigger(
        project_id=project_id, thread_id=thread_id, before_event_id=second.id
    )

    assert latest.id == on_third.id
    assert before_second.id == on_first.id
