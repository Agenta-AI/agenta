import asyncio
import os
import json
from contextlib import asynccontextmanager
from multiprocessing import get_context
from uuid import UUID, uuid4
from sqlalchemy import MetaData, Table, Column, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.channels.dbes import ChannelThreadDBE
from oss.src.core.channels.dtos import ChannelThreadCreate, ChannelThreadData

if "projects" not in ChannelThreadDBE.metadata.tables:
    Table("projects", ChannelThreadDBE.metadata, Column("id", PGUUID, primary_key=True))

URI = os.environ["CHANNELS_TEST_POSTGRES_URI"]
SCHEMA = "channels_parent_replica"


class Engine:
    def __init__(self):
        self.engine = create_async_engine(
            URI, connect_args={"server_settings": {"search_path": SCHEMA}}
        )
        self.maker = async_sessionmaker(self.engine, expire_on_commit=False)

    @asynccontextmanager
    async def session(self):
        async with self.maker() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise


async def setup(project):
    e = Engine()
    async with e.engine.begin() as c:
        await c.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        meta = MetaData()
        Table("projects", meta, Column("id", PGUUID, primary_key=True))
        ChannelThreadDBE.__table__.to_metadata(meta)
        await c.run_sync(meta.create_all)
        await c.execute(text("INSERT INTO projects(id) VALUES (:id)"), {"id": project})
    await e.engine.dispose()


async def create(args):
    project, space, agent, key = args
    e = Engine()
    dao = ChannelsDAO(engine=e)
    row = await dao.create_thread(
        project_id=UUID(project),
        user_id=None,
        thread=ChannelThreadCreate(
            space_id=UUID(space),
            agent_id=UUID(agent),
            external_key=UUID(key) if key else None,
            session_id=str(uuid4()),
            data=ChannelThreadData(),
        ),
    )
    await e.engine.dispose()
    return (str(row.id), row.session_id)


def worker(args, barrier, out):
    if os.getenv("CHANNELS_REPRO_BASELINE"):
        import subprocess
        import oss.src.dbs.postgres.channels.dao as module

        source = subprocess.check_output(
            [
                "git",
                "show",
                "cf84446c349d0ae8df21f6dac65d31db52fa36ff:api/oss/src/dbs/postgres/channels/dao.py",
            ],
            text=True,
        )
        exec(compile(source, "baseline-dao.py", "exec"), module.__dict__)
        globals()["ChannelsDAO"] = module.ChannelsDAO
    barrier.wait()
    out.put(asyncio.run(create(args)))


async def close_thread(thread):
    e = Engine()
    async with e.engine.begin() as c:
        await c.execute(
            text(
                "UPDATE channel_threads SET flags='{\"is_active\": false}'::jsonb WHERE id=:id"
            ),
            {"id": UUID(thread)},
        )
    await e.engine.dispose()


if __name__ == "__main__":
    reports = []
    for key in [str(uuid4()), None]:
        args = (str(uuid4()), str(uuid4()), str(uuid4()), key)
        asyncio.run(setup(UUID(args[0])))
        ctx = get_context("spawn")
        barrier = ctx.Barrier(4)
        out = ctx.Queue()
        ps = [ctx.Process(target=worker, args=(args, barrier, out)) for _ in range(4)]
        for p in ps:
            p.start()
        rows = [out.get(timeout=45) for _ in ps]
        for p in ps:
            p.join(10)
            assert p.exitcode == 0
        unique = len(set(rows))
        reports.append(
            {"null_key": key is None, "processes": 4, "distinct_sessions": unique}
        )
        if not os.getenv("CHANNELS_REPRO_BASELINE"):
            assert unique == 1, rows
            asyncio.run(close_thread(rows[0][0]))
            fresh = asyncio.run(create(args))
            assert fresh != rows[0]
            assert asyncio.run(create(args)) == fresh
            reports[-1]["closed_thread_replaced_once"] = True
    print(json.dumps(reports, indent=2))
