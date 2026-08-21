import pytest

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
)
from oss.src.dbs.postgres.channels.dao import ChannelsDAO


pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1"}


def _event(
    *, connection_id, external_id, origin=ChannelEventOrigin.PUSHED
) -> ChannelInboxEventCreate:
    return ChannelInboxEventCreate(
        connection_id=connection_id,
        external_id=external_id,
        kind=ChannelEventKind.MESSAGE,
        origin=origin,
        data=ChannelInboxEventData(
            external_locator=LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": external_id}],
                sender={"id": "U1"},
            ),
        ),
    )


async def test_record_inbox_event_dedups_on_connection_and_external_id(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    first = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="Ev1"),
    )
    second = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="Ev1"),
    )

    assert first is not None
    assert second is None

    rows = await dao.query_inbox_events(project_id=project_id)
    assert len(rows) == 1
    assert rows[0].id == first.id


async def test_record_inbox_events_bulk_preserves_fetch_order(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    events = [
        _event(
            connection_id=connection_id,
            external_id=f"bulk-{i}",
            origin=ChannelEventOrigin.PULLED,
        )
        for i in range(5)
    ]

    inserted = await dao.record_inbox_events(project_id=project_id, events=events)

    assert [e.external_id for e in inserted] == [f"bulk-{i}" for i in range(5)]
    assert [e.id for e in inserted] == sorted(e.id for e in inserted)


async def test_query_events_since_orders_pulled_before_pushed_by_origin(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    pushed = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="pushed-first"),
    )
    space_id = pushed.id  # any UUID works as space_id for this DAO-level test
    await dao.attach_space(project_id=project_id, event_id=pushed.id, space_id=space_id)

    # backfill arrives (wall-clock) AFTER the push, but must sort BEFORE it.
    pulled = await dao.record_inbox_events(
        project_id=project_id,
        events=[
            _event(
                connection_id=connection_id,
                external_id="pulled-after",
                origin=ChannelEventOrigin.PULLED,
            )
        ],
    )
    await dao.attach_space(
        project_id=project_id, event_id=pulled[0].id, space_id=space_id
    )

    rows = await dao.query_events_since(
        project_id=project_id, space_id=space_id, after_event_id=None
    )

    assert [row.external_id for row in rows] == ["pulled-after", "pushed-first"]


async def test_query_events_since_none_reads_the_whole_log(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    event = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="only-one"),
    )
    space_id = event.id
    await dao.attach_space(project_id=project_id, event_id=event.id, space_id=space_id)

    rows = await dao.query_events_since(
        project_id=project_id, space_id=space_id, after_event_id=None
    )

    assert len(rows) == 1
    assert rows[0].external_id == "only-one"


async def test_query_events_since_range_excludes_the_offset_itself(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    first = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="first"),
    )
    space_id = first.id
    await dao.attach_space(project_id=project_id, event_id=first.id, space_id=space_id)

    second = await dao.record_inbox_event(
        project_id=project_id,
        event=_event(connection_id=connection_id, external_id="second"),
    )
    await dao.attach_space(project_id=project_id, event_id=second.id, space_id=space_id)

    rows = await dao.query_events_since(
        project_id=project_id, space_id=space_id, after_event_id=first.id
    )

    assert [row.external_id for row in rows] == ["second"]
