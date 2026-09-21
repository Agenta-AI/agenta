import asyncio
import json
from multiprocessing import get_context
from uuid import UUID, uuid4
from sqlalchemy import MetaData, Table, Column, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from thread_check import Engine
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.types import (
    IdempotencyKeyReused,
    InteractionResponseConflict,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.sessions.interactions.dbes import SessionInteractionDBE

TABLES = [
    SessionCommandDBE.__table__,
    SessionExecutionDBE.__table__,
    SessionInteractionDBE.__table__,
]


class Delivery:
    async def deliver(self, *, command):
        return DeliveryReceipt(status="accepted", replica_id="test-runner")


async def setup(args):
    project, session, execution, interaction = args
    e = Engine()
    meta = MetaData()
    Table("projects", meta, Column("id", PGUUID, primary_key=True))
    for t in TABLES:
        t.to_metadata(meta)
    async with e.engine.begin() as c:
        await c.run_sync(meta.create_all)
        await c.execute(
            text("INSERT INTO projects(id) VALUES (:id)"), {"id": UUID(project)}
        )
        await c.execute(
            SessionExecutionDBE.__table__.insert().values(
                project_id=UUID(project),
                session_id=session,
                execution_id=execution,
                state="active",
            )
        )
        await c.execute(
            SessionInteractionDBE.__table__.insert().values(
                project_id=UUID(project),
                id=UUID(interaction),
                session_id=session,
                turn_id=execution,
                token="approval-token",
                kind="user_approval",
                status="pending",
                data={},
            )
        )
    await e.engine.dispose()


async def answer(args, approved):
    project, session, execution, interaction = args
    e = Engine()
    service = SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=e),
        executions_dao=SessionExecutionsDAO(engine=e),
        interactions_service=SessionInteractionsService(
            interactions_dao=SessionInteractionsDAO(engine=e)
        ),
        streams_service=None,
        lock_engine=None,
        delivery=Delivery(),
    )
    try:
        a = await service.respond_interaction(
            project_id=UUID(project),
            user_id=uuid4(),
            interaction_id=UUID(interaction),
            answer={"approved": approved, "message": "Approve" if approved else "Deny"},
            expected_execution_id=None,
            idempotency_key=f"channels:{interaction}",
        )
        result = {
            "accepted": True,
            "execution_id": a.execution_id,
            "command_id": str(a.command.id),
        }
    except (IdempotencyKeyReused, InteractionResponseConflict) as ex:
        result = {"accepted": False, "conflict": type(ex).__name__}
    await e.engine.dispose()
    return result


def worker(args, approved, barrier, out):
    barrier.wait()
    try:
        out.put(asyncio.run(answer(args, approved)))
    except Exception as ex:
        out.put({"error": repr(ex)})
        raise


async def counts(args):
    e = Engine()
    p = UUID(args[0])
    async with e.engine.connect() as c:
        n = (
            await c.execute(
                text("SELECT count(*) FROM session_commands WHERE project_id=:p"),
                {"p": p},
            )
        ).scalar()
        m = (
            await c.execute(
                text(
                    "SELECT count(*) FROM session_executions WHERE project_id=:p AND parent_execution_id IS NOT NULL"
                ),
                {"p": p},
            )
        ).scalar()
    await e.engine.dispose()
    return n, m


if __name__ == "__main__":
    reports = []
    for choices in [(True, True), (True, False)]:
        args = tuple(str(uuid4()) for _ in range(4))
        asyncio.run(setup(args))
        ctx = get_context("spawn")
        barrier = ctx.Barrier(2)
        out = ctx.Queue()
        ps = [ctx.Process(target=worker, args=(args, a, barrier, out)) for a in choices]
        for p in ps:
            p.start()
        rows = [out.get(timeout=45) for _ in ps]
        for p in ps:
            p.join(10)
            assert p.exitcode == 0, rows
        n, m = asyncio.run(counts(args))
        assert (n, m) == (1, 1), (rows, n, m)
        assert sum(r.get("accepted", False) for r in rows) == (
            2 if choices[0] == choices[1] else 1
        ), rows
        reports.append(
            {"answers": choices, "results": rows, "commands": n, "continuations": m}
        )
    print(json.dumps(reports, indent=2))
