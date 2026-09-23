import asyncio
import uuid

import pytest
from sqlalchemy import text

from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.channels.dao import ChannelsDAO


pytestmark = pytest.mark.integration


async def test_record_outbox_event_conflict_returns_existing_row_not_none(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    thread_id = uuid.uuid4()
    key = uuid.uuid4()

    first = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-1",
            key=key,
            data=ChannelOutboxEventData(),
        ),
    )
    second = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-1",
            key=key,
            data=ChannelOutboxEventData(),
        ),
    )

    assert second is not None
    assert second.id == first.id

    rows = await dao.query_outbox_events(project_id=project_id)
    assert len(rows) == 1


async def test_transition_outbox_event_created_to_sent_keeps_one_row(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    thread_id = uuid.uuid4()
    key = uuid.uuid4()

    created = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-1",
            key=key,
            data=ChannelOutboxEventData(),
        ),
    )
    assert created.state == ChannelDeliveryState.CREATED

    locator = {"channel": "C1", "ts": "169000.1"}
    sent = await dao.transition_outbox_event(
        project_id=project_id,
        event_id=created.id,
        state=ChannelDeliveryState.SENT,
        data=ChannelOutboxEventData(external_locator=locator),
    )

    assert sent is not None
    assert sent.id == created.id
    assert sent.key == created.key
    assert sent.state == ChannelDeliveryState.SENT
    assert sent.data.external_locator == locator

    rows = await dao.query_outbox_events(project_id=project_id, event=None)
    assert len(rows) == 1


async def test_one_row_for_its_life_across_created_sent_and_edited(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    thread_id = uuid.uuid4()
    key = uuid.uuid4()

    created = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-1",
            key=key,
            data=ChannelOutboxEventData(),
        ),
    )

    locator = {"channel": "C1", "ts": "169000.1"}
    await dao.transition_outbox_event(
        project_id=project_id,
        event_id=created.id,
        state=ChannelDeliveryState.SENT,
        data=ChannelOutboxEventData(external_locator=locator),
    )

    edited = await dao.transition_outbox_event(
        project_id=project_id,
        event_id=created.id,
        state=ChannelDeliveryState.SENT,
        status=Status(type="ok", code="200"),
        data=ChannelOutboxEventData(
            external_locator=locator, processed={"final": True}
        ),
    )

    assert edited.id == created.id
    assert edited.key == created.key
    assert edited.data.external_locator == locator
    assert edited.data.processed == {"final": True}

    rows = await dao.query_outbox_events(project_id=project_id, event=None)
    assert len(rows) == 1
    assert rows[0].id == created.id


async def test_claim_outbox_events_returns_only_created_rows_oldest_first(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    thread_id = uuid.uuid4()

    first = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-1",
            key=uuid.uuid4(),
            data=ChannelOutboxEventData(),
        ),
    )
    second = await dao.record_outbox_event(
        project_id=project_id,
        event=ChannelOutboxEventCreate(
            connection_id=connection_id,
            thread_id=thread_id,
            turn_id="turn-2",
            key=uuid.uuid4(),
            data=ChannelOutboxEventData(),
        ),
    )
    await dao.transition_outbox_event(
        project_id=project_id, event_id=second.id, state=ChannelDeliveryState.SENT
    )

    claimed = await dao.claim_outbox_events(project_id=project_id, limit=100)

    assert [row.id for row in claimed] == [first.id]


async def _new_outbox_row(dao, scope):
    return await dao.record_outbox_event(
        project_id=scope["project_id"],
        event=ChannelOutboxEventCreate(
            connection_id=scope["connection_id"],
            thread_id=uuid.uuid4(),
            turn_id="turn-claim",
            key=uuid.uuid4(),
            data=ChannelOutboxEventData(),
        ),
    )


_CONTENT = [{"type": "text", "text": "the answer"}]


async def test_claim_outbox_delivery_has_exactly_one_winner_under_a_race(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    row = await _new_outbox_row(dao, channels_scope)

    results = await asyncio.gather(
        *(
            dao.claim_outbox_delivery(
                project_id=channels_scope["project_id"],
                event_id=row.id,
                content=_CONTENT,
                claim_ttl_seconds=60,
            )
            for _ in range(8)
        )
    )

    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    assert winners[0].status.code == "sending"


async def test_claim_outbox_delivery_refuses_content_already_sent_and_takes_new_content(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    row = await _new_outbox_row(dao, channels_scope)

    claimed = await dao.claim_outbox_delivery(
        project_id=project_id, event_id=row.id, content=_CONTENT, claim_ttl_seconds=60
    )
    assert claimed is not None
    await dao.transition_outbox_event(
        project_id=project_id,
        event_id=row.id,
        state=ChannelDeliveryState.SENT,
        status=Status(code="sent"),
        data=ChannelOutboxEventData(
            external_locator={"ts": "1"},
            # key order differs from `_CONTENT`: compared by value, not text
            processed={"content": [{"text": "the answer", "type": "text"}]},
        ),
    )

    same = await dao.claim_outbox_delivery(
        project_id=project_id, event_id=row.id, content=_CONTENT, claim_ttl_seconds=60
    )
    assert same is None

    edit = await dao.claim_outbox_delivery(
        project_id=project_id,
        event_id=row.id,
        content=[{"type": "text", "text": "an edit"}],
        claim_ttl_seconds=60,
    )
    assert edit is not None
    assert edit.data.external_locator == {"ts": "1"}  # the receipt to edit


async def test_claim_outbox_delivery_takes_over_a_stale_claim(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    row = await _new_outbox_row(dao, channels_scope)

    assert await dao.claim_outbox_delivery(
        project_id=project_id, event_id=row.id, content=_CONTENT, claim_ttl_seconds=60
    )
    # a live claim blocks a second worker
    assert (
        await dao.claim_outbox_delivery(
            project_id=project_id,
            event_id=row.id,
            content=_CONTENT,
            claim_ttl_seconds=60,
        )
        is None
    )

    # the holder died mid-post five minutes ago
    async with channels_scope["engine"].session() as session:
        await session.execute(
            text(
                "UPDATE channel_outbox_events "
                "SET updated_at = now() - interval '5 minutes' WHERE id = :id"
            ),
            {"id": row.id},
        )
        await session.commit()

    assert (
        await dao.claim_outbox_delivery(
            project_id=project_id,
            event_id=row.id,
            content=_CONTENT,
            claim_ttl_seconds=60,
        )
        is not None
    )


async def test_claim_outbox_delivery_keeps_a_final_answer_from_non_final_edits(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    row = await _new_outbox_row(dao, channels_scope)
    await dao.transition_outbox_event(
        project_id=project_id,
        event_id=row.id,
        state=ChannelDeliveryState.SENT,
        status=Status(code="sent"),
        data=ChannelOutboxEventData(
            external_locator={"ts": "1"},
            processed={"content": _CONTENT, "final": True},
        ),
    )
    progress = [{"type": "text", "text": "partial"}]

    assert (
        await dao.claim_outbox_delivery(
            project_id=project_id,
            event_id=row.id,
            content=progress,
            claim_ttl_seconds=60,
            overwrite_final=False,
        )
        is None
    )
    assert (
        await dao.claim_outbox_delivery(
            project_id=project_id,
            event_id=row.id,
            content=progress,
            claim_ttl_seconds=60,
            overwrite_final=True,
        )
        is not None
    )
