import asyncio
import json
from datetime import datetime, timezone
from multiprocessing import get_context
from uuid import UUID, uuid4
from sqlalchemy import MetaData, Table, Column, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from thread_check import Engine, setup, create
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.channels.dbes import (
    ChannelInboxEventDBE,
    ChannelInboxTriggerDBE,
)
from oss.src.core.channels.dtos import (
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxTriggerCreate,
    ChannelPendingChoice,
    ChannelInboxEventProcessed,
)


async def init(project):
    e = Engine()
    meta = MetaData()
    Table("projects", meta, Column("id", PGUUID, primary_key=True))
    for t in [ChannelInboxEventDBE.__table__, ChannelInboxTriggerDBE.__table__]:
        t.to_metadata(meta)
    async with e.engine.begin() as c:
        await c.run_sync(meta.create_all)
    await e.engine.dispose()


async def event(args):
    project, connection, thread = args
    e = Engine()
    dao = ChannelsDAO(engine=e)
    row = await dao.record_inbox_event(
        project_id=UUID(project),
        event=ChannelInboxEventCreate(
            connection_id=UUID(connection),
            external_id="provider-redelivery",
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator={"chat": "qa"},
                processed=ChannelInboxEventProcessed(content=[], sender={}),
            ),
        ),
    )
    # Ingress publishes retries too; both consumers resolve the same durable event.
    async with e.engine.connect() as c:
        evt = (
            await c.execute(
                text(
                    "SELECT id FROM channel_inbox_events WHERE project_id=:p AND external_id=:e"
                ),
                {"p": UUID(project), "e": "provider-redelivery"},
            )
        ).scalar_one()
    trigger = await dao.record_inbox_trigger(
        project_id=UUID(project),
        trigger=ChannelInboxTriggerCreate(
            thread_id=UUID(thread), event_id=evt, turn_id=str(uuid4())
        ),
    )
    await e.engine.dispose()
    return {"inserted_event": row is not None, "admitted_turn": trigger is not None}


def worker(args, barrier, out):
    barrier.wait()
    try:
        out.put(asyncio.run(event(args)))
    except Exception as ex:
        out.put({"error": repr(ex)})
        raise


async def stale(args):
    project, space, agent, key = args
    thread, _ = await create(args)
    e = Engine()
    dao = ChannelsDAO(engine=e)
    old, new = str(uuid4()), str(uuid4())
    choice = ChannelPendingChoice(
        interaction_id=new, choices=[], posted_at=datetime.now(timezone.utc)
    )
    await dao.set_pending_choice(
        project_id=UUID(project), thread_id=UUID(thread), pending_choice=choice
    )
    row = await dao.set_pending_choice(
        project_id=UUID(project),
        thread_id=UUID(thread),
        pending_choice=None,
        expected_interaction_id=old,
    )
    assert row.data.pending_choice.interaction_id == new
    row = await dao.set_pending_choice(
        project_id=UUID(project),
        thread_id=UUID(thread),
        pending_choice=None,
        expected_interaction_id=new,
    )
    assert row.data.pending_choice is None
    await e.engine.dispose()


if __name__ == "__main__":
    args = tuple(str(uuid4()) for _ in range(4))
    asyncio.run(setup(UUID(args[0])))
    thread, _ = asyncio.run(create(args))
    asyncio.run(init(UUID(args[0])))
    ctx = get_context("spawn")
    barrier = ctx.Barrier(2)
    out = ctx.Queue()
    ps = [
        ctx.Process(target=worker, args=((args[0], args[1], thread), barrier, out))
        for _ in range(2)
    ]
    for p in ps:
        p.start()
    rows = [out.get(timeout=45) for _ in ps]
    for p in ps:
        p.join(10)
        assert p.exitcode == 0, rows
    assert sum(r["inserted_event"] for r in rows) == 1, rows
    assert sum(r["admitted_turn"] for r in rows) == 1, rows
    asyncio.run(stale(args))
    print(
        json.dumps(
            {"duplicate_provider": rows, "stale_clear_preserves_new_question": True},
            indent=2,
        )
    )
