import pytest

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTriggerCreate,
    ChannelTriggerState,
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
