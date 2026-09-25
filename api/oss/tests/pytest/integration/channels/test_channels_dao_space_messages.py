"""A space's stored messages for the channel read tool: people's messages
from the inbox in provider order, and the bot's sent posts from the outbox
with the thread each belongs to."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThreadCreate,
    ChannelThreadData,
)
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


async def _space(dao, scope):
    return await dao.create_space(
        project_id=scope["project_id"],
        user_id=scope["user_id"],
        space=ChannelSpaceCreate(
            connection_id=scope["connection_id"],
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )


async def _inbox(dao, scope, space, text, *, minutes, thread_ts=None, kind=None):
    ts = f"{int((T0 + timedelta(minutes=minutes)).timestamp())}.000000"
    locator = {"team": "T1", "channel": "C1", "thread_ts": thread_ts or ts}
    return await dao.record_inbox_event(
        project_id=scope["project_id"],
        event=ChannelInboxEventCreate(
            connection_id=scope["connection_id"],
            external_id=f"C1:{ts}:{text}",
            kind=kind or ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            space_id=space.id,
            data=ChannelInboxEventData(
                external_locator=locator,
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": text}],
                    sender={"id": "U1", "name": "Ada"},
                    sent_at=T0 + timedelta(minutes=minutes),
                    message_ref=ts,
                ),
            ),
        ),
    )


async def _sent(dao, scope, space, *, ts, thread_id=None, processed=None):
    row = await dao.record_outbox_event(
        project_id=scope["project_id"],
        event=ChannelOutboxEventCreate(
            connection_id=scope["connection_id"],
            thread_id=thread_id,
            space_id=space.id,
            turn_id=f"turn-{ts}",
            key=uuid.uuid4(),
            data=ChannelOutboxEventData(),
        ),
    )
    await dao.transition_outbox_event(
        project_id=scope["project_id"],
        event_id=row.id,
        state=ChannelDeliveryState.SENT,
        data=ChannelOutboxEventData(
            external_locator={"channel": "C1", "ts": ts},
            processed=processed
            or {"content": [{"type": "text", "text": ts}], "final": True},
        ),
    )
    return row


async def test_inbox_messages_come_newest_first_by_provider_time(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    # stored out of order: a fetched page arrives after newer pushed messages
    await _inbox(dao, channels_scope, space, "second", minutes=2)
    await _inbox(dao, channels_scope, space, "first", minutes=1)
    await _inbox(dao, channels_scope, space, "third", minutes=3)

    rows = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"], space_id=space.id, limit=10
    )

    assert [r.data.processed.content[0]["text"] for r in rows] == [
        "third",
        "second",
        "first",
    ]


async def test_before_cursor_pages_older_without_gaps(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    for minute in range(1, 6):
        await _inbox(dao, channels_scope, space, f"m{minute}", minutes=minute)

    page = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"], space_id=space.id, limit=2
    )
    older = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"],
        space_id=space.id,
        before=(page[-1].sent_at, page[-1].id),
        limit=10,
    )

    texts = [r.data.processed.content[0]["text"] for r in page + older]
    assert texts == ["m5", "m4", "m3", "m2", "m1"]


async def test_thread_filter_returns_root_and_replies(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    root = await _inbox(dao, channels_scope, space, "root", minutes=1)
    root_ts = root.data.processed.message_ref
    await _inbox(dao, channels_scope, space, "reply", minutes=2, thread_ts=root_ts)
    await _inbox(dao, channels_scope, space, "elsewhere", minutes=3)

    rows = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"],
        space_id=space.id,
        thread_ts=root_ts,
        limit=10,
    )

    assert [r.data.processed.content[0]["text"] for r in rows] == ["reply", "root"]


async def test_action_events_are_skipped(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    await _inbox(dao, channels_scope, space, "said", minutes=1)
    await _inbox(
        dao, channels_scope, space, "clicked", minutes=2, kind=ChannelEventKind.ACTION
    )

    rows = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"], space_id=space.id, limit=10
    )

    assert [r.data.processed.content[0]["text"] for r in rows] == ["said"]


async def test_bot_posts_carry_their_thread(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    space = await _space(dao, channels_scope)
    thread = await dao.create_thread(
        project_id=project_id,
        user_id=None,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=uuid.uuid4(),
            session_id="s-1",
            data=ChannelThreadData(
                external_locator={"team": "T1", "channel": "C1", "thread_ts": "100.1"}
            ),
        ),
    )
    await _sent(dao, channels_scope, space, ts="101.1", thread_id=thread.id)
    await _sent(
        dao,
        channels_scope,
        space,
        ts="102.1",
        processed={"content": [], "thread_ts": "100.1", "final": True},
    )
    await _sent(dao, channels_scope, space, ts="103.1")
    unsent = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=channels_scope["connection_id"],
            space_id=space.id,
            turn_id="t",
            key=uuid.uuid4(),
            data=ChannelOutboxEventData(),
        ),
    )

    everything = await dao.query_space_outbox_messages(
        project_id=project_id, space_id=space.id, limit=10
    )
    in_thread = await dao.query_space_outbox_messages(
        project_id=project_id, space_id=space.id, thread_ts="100.1", limit=10
    )

    threads = {row.data.external_locator["ts"]: t for row, t in everything}
    assert threads == {"101.1": "100.1", "102.1": "100.1", "103.1": "103.1"}
    assert unsent.id not in {row.id for row, _ in everything}
    assert sorted(row.data.external_locator["ts"] for row, _ in in_thread) == [
        "101.1",
        "102.1",
    ]


async def test_messages_in_the_same_second_page_without_loss(channels_scope):
    """Telegram dates have one-second precision: a cursor on time alone would
    drop the rest of a second at a page boundary."""
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    for name in ("a", "b", "c", "d"):
        await _inbox(dao, channels_scope, space, name, minutes=1)

    seen = []
    before = None
    while True:
        page = await dao.query_space_inbox_messages(
            project_id=channels_scope["project_id"],
            space_id=space.id,
            before=before,
            limit=3,
        )
        if not page:
            break
        seen += page
        before = (page[-1].sent_at, page[-1].id)

    assert sorted(r.data.processed.content[0]["text"] for r in seen) == [
        "a",
        "b",
        "c",
        "d",
    ]
    assert len({r.id for r in seen}) == 4


async def test_a_fetched_copy_of_the_bots_post_is_left_out(channels_scope):
    """The outbox serves the bot's own posts; a copy a history fetch stored in
    the inbox must not come back, or the two sources would overlap."""
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    await _sent(dao, channels_scope, space, ts="1756728000.000000")
    await dao.record_inbox_event(
        project_id=channels_scope["project_id"],
        event=ChannelInboxEventCreate(
            connection_id=channels_scope["connection_id"],
            external_id="C1:1756728000.000000",
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PULLED,
            space_id=space.id,
            data=ChannelInboxEventData(
                external_locator={"team": "T1", "channel": "C1"},
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "bot copy"}],
                    sender={"id": "UBOT"},
                    message_ref="1756728000.000000",
                ),
            ),
        ),
    )
    await _inbox(dao, channels_scope, space, "person", minutes=1)

    rows = await dao.query_space_inbox_messages(
        project_id=channels_scope["project_id"], space_id=space.id, limit=10
    )

    assert [r.data.processed.content[0]["text"] for r in rows] == ["person"]


async def test_a_running_turns_indicator_is_not_a_message(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = await _space(dao, channels_scope)
    await _sent(
        dao,
        channels_scope,
        space,
        ts="200.1",
        processed={"content": [{"type": "text", "text": "Thinking..."}]},
    )
    await _sent(dao, channels_scope, space, ts="201.1")

    rows = await dao.query_space_outbox_messages(
        project_id=channels_scope["project_id"], space_id=space.id, limit=10
    )

    assert [row.data.external_locator["ts"] for row, _ in rows] == ["201.1"]
