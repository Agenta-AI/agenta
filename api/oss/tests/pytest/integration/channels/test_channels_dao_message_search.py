"""Full-text search over stored channel messages: the expression index, the
filters, a stable page order, and project isolation."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
)
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


async def _message(dao, scope, space_id, body, *, minutes=0, kind=None):
    return await dao.record_inbox_event(
        project_id=scope["project_id"],
        event=ChannelInboxEventCreate(
            connection_id=scope["connection_id"],
            external_id=f"{uuid.uuid4()}",
            kind=kind or ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            space_id=space_id,
            data=ChannelInboxEventData(
                external_locator={"team": "T1", "channel": "C1"},
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": body}],
                    sender={"id": "U1"},
                    sent_at=T0 + timedelta(minutes=minutes),
                ),
            ),
        ),
    )


def _texts(rows):
    # a person's message is an inbox event; the bot's post is (outbox row, thread)
    return [
        r.data.processed.content[0]["text"]
        if isinstance(r, ChannelInboxEvent)
        else r[0].data.processed["content"][0]["text"]
        for r in rows
    ]


async def test_search_matches_words(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    await _message(dao, channels_scope, space, "the refund policy changed")
    await _message(dao, channels_scope, space, "lunch at noon")
    await _message(dao, channels_scope, space, "refund", kind=ChannelEventKind.ACTION)

    rows = await dao.search_space_messages(
        project_id=channels_scope["project_id"],
        space_ids=[space],
        query="refund policy",
        limit=10,
    )

    assert _texts(rows) == ["the refund policy changed"]


async def test_search_filters_by_space_and_time(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space, other = uuid.uuid4(), uuid.uuid4()
    await _message(dao, channels_scope, space, "deploy early", minutes=1)
    await _message(dao, channels_scope, space, "deploy late", minutes=10)
    await _message(dao, channels_scope, other, "deploy elsewhere", minutes=5)

    rows = await dao.search_space_messages(
        project_id=channels_scope["project_id"],
        space_ids=[space],
        query="deploy",
        after=T0 + timedelta(minutes=5),
        limit=10,
    )

    assert _texts(rows) == ["deploy late"]


async def test_offset_pages_are_stable_for_equal_rank_and_time(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    for i in range(5):
        await _message(dao, channels_scope, space, f"incident {i}", minutes=0)

    seen = []
    for offset in range(0, 5, 2):
        seen += await dao.search_space_messages(
            project_id=channels_scope["project_id"],
            space_ids=[space],
            query="incident",
            limit=2,
            offset=offset,
        )

    assert len(seen) == 5
    assert len({row.id for row in seen}) == 5


async def test_search_is_project_scoped(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    await _message(dao, channels_scope, space, "secret roadmap")

    rows = await dao.search_space_messages(
        project_id=uuid.uuid4(), space_ids=[space], query="roadmap", limit=10
    )

    assert rows == []


async def test_query_uses_the_expression_index(channels_scope):
    """The search must spell the indexed expression exactly, or Postgres
    cannot use the index. With sequential scans off and nothing else to
    filter on, only the full-text index can serve the match."""
    from sqlalchemy import func, literal_column, select

    from oss.src.dbs.postgres.channels.dao import _SEARCH_VECTOR
    from oss.src.dbs.postgres.channels.dbes import ChannelInboxEventDBE

    tsquery = func.websearch_to_tsquery(literal_column("'simple'"), "refund")
    stmt = select(ChannelInboxEventDBE.id).where(_SEARCH_VECTOR.op("@@")(tsquery))
    compiled = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )

    async with channels_scope["engine"].session() as session:
        await session.execute(text("SET LOCAL enable_seqscan = off"))
        plan = await session.execute(text(f"EXPLAIN {compiled}"))
        lines = " ".join(row[0] for row in plan.all())

    assert "ix_channel_inbox_events_search" in lines


async def _bot_post(dao, scope, space_id, body, ts, *, final=True):
    from oss.src.core.channels.dtos import (
        ChannelDeliveryState,
        ChannelOutboxEventCreate,
        ChannelOutboxEventData,
    )

    row = await dao.record_outbox_event(
        project_id=scope["project_id"],
        event=ChannelOutboxEventCreate(
            connection_id=scope["connection_id"],
            space_id=space_id,
            turn_id=f"toolu_{ts}",
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
            processed={
                "content": [{"type": "text", "text": body}],
                **({"final": True} if final else {}),
            },
        ),
    )


async def test_search_finds_the_bots_posts_once(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    space = uuid.uuid4()
    await _bot_post(dao, channels_scope, space, "bot said launch", "77.1")
    # a running turn's placeholder is not something the bot said
    await _bot_post(dao, channels_scope, space, "launch thinking", "78.1", final=False)
    # a live read stored a copy of the bot's post; the outbox row already serves it
    await dao.record_inbox_event(
        project_id=project_id,
        event=ChannelInboxEventCreate(
            connection_id=channels_scope["connection_id"],
            external_id="C1:77.1",
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PULLED,
            space_id=space,
            data=ChannelInboxEventData(
                external_locator={"team": "T1", "channel": "C1"},
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "bot said launch"}],
                    sender={"id": "UBOT"},
                    message_ref="77.1",
                ),
            ),
        ),
    )
    await _message(dao, channels_scope, space, "person said launch")

    rows = await dao.search_space_messages(
        project_id=project_id, space_ids=[space], query="launch", limit=10
    )

    assert sorted(_texts(rows)) == ["bot said launch", "person said launch"]
    post, thread = next(r for r in rows if not isinstance(r, ChannelInboxEvent))
    assert thread == "77.1"


async def test_search_leaves_out_answers_consumed_by_an_approval(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    kept = await _message(dao, channels_scope, space, "approve the budget please")
    consumed = await _message(dao, channels_scope, space, "approve")
    await dao.mark_inbox_event_consumed(
        project_id=channels_scope["project_id"], event_id=consumed.id
    )

    rows = await dao.search_space_messages(
        project_id=channels_scope["project_id"],
        space_ids=[space],
        query="approve",
        limit=10,
    )

    assert [r.id for r in rows] == [kept.id]


async def test_a_bot_post_is_filtered_by_its_slack_time(channels_scope):
    # A reply settled minutes after its row was created shows Slack's time; the time
    # filter must use that same time, or the post falls outside a range it shows inside.
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    posted = datetime.now(timezone.utc) + timedelta(minutes=5)
    await _bot_post(
        dao, channels_scope, space, "late rollout", f"{posted.timestamp():.6f}"
    )

    rows = await dao.search_space_messages(
        project_id=channels_scope["project_id"],
        space_ids=[space],
        query="rollout",
        after=posted - timedelta(minutes=1),
        limit=10,
    )

    assert _texts(rows) == ["late rollout"]


async def test_pages_mix_people_and_bot_posts_without_repeats(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    space = uuid.uuid4()
    for i in range(3):
        await _message(dao, channels_scope, space, f"outage {i}", minutes=i)
        await _bot_post(dao, channels_scope, space, f"outage bot {i}", f"{80 + i}.1")

    seen = []
    for offset in range(0, 6, 4):
        seen += await dao.search_space_messages(
            project_id=channels_scope["project_id"],
            space_ids=[space],
            query="outage",
            limit=4,
            offset=offset,
        )

    assert sorted(_texts(seen)) == sorted(
        [f"outage {i}" for i in range(3)] + [f"outage bot {i}" for i in range(3)]
    )
