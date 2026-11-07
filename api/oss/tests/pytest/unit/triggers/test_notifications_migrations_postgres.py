"""`oss000000063` and `oss000000064`, on a scratch database with the two tables they need."""

from uuid import uuid4

import pytest
import pytest_asyncio
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import load_revision_module

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DATABASE = "agenta_scratch_notifications"
NOTIFICATIONS = "oss000000063_add_notifications.py"
UNSETTLED_INDEX = "oss000000064_add_trigger_deliveries_unsettled_index.py"
INDEX_NAME = "ix_trigger_deliveries_unsettled_created_at_id"


@pytest_asyncio.fixture
async def scratch():
    url = make_url(env.postgres.uri_core)
    admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as connection:
        await connection.execute(text(f'DROP DATABASE IF EXISTS "{DATABASE}"'))
        await connection.execute(text(f'CREATE DATABASE "{DATABASE}"'))

    engine = create_async_engine(
        url.set(database=DATABASE), isolation_level="AUTOCOMMIT"
    )
    async with engine.connect() as connection:
        await connection.execute(text("CREATE TABLE projects (id UUID PRIMARY KEY)"))
        await connection.execute(
            text(
                "CREATE TABLE trigger_deliveries ("
                "project_id UUID, id UUID, created_at TIMESTAMPTZ, "
                "status JSONB, data JSON)"
            )
        )
    yield engine

    await engine.dispose()
    async with admin.connect() as connection:
        await connection.execute(text(f'DROP DATABASE IF EXISTS "{DATABASE}"'))
    await admin.dispose()


async def _run(engine, revision, step):
    module = load_revision_module(revision)

    def run(sync_connection):
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            getattr(module, step)()

    async with engine.connect() as connection:
        await connection.run_sync(run)


async def _value(engine, sql, **params):
    async with engine.connect() as connection:
        return (await connection.execute(text(sql), params)).scalar()


async def _tables(engine):
    return await _value(
        engine,
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_name IN ('notifications', 'notification_deliveries')",
    )


async def _index_is_valid(engine):
    return await _value(
        engine,
        "SELECT i.indisvalid FROM pg_index i "
        "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = :name",
        name=INDEX_NAME,
    )


async def test_the_tables_revision_upgrades_and_downgrades(scratch):
    await _run(scratch, NOTIFICATIONS, "upgrade")
    assert await _tables(scratch) == 2

    project_id = uuid4()
    async with scratch.connect() as connection:
        await connection.execute(
            text("INSERT INTO projects (id) VALUES (:id)"), {"id": project_id}
        )
        for _ in range(2):
            await connection.execute(
                text(
                    "INSERT INTO notifications "
                    "(project_id, id, kind, dedup_key, state, data) VALUES "
                    "(:project_id, :id, 'k', 'one', 'resolved', '{}')"
                ),
                {"project_id": project_id, "id": uuid4()},
            )
        await connection.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
    assert await _value(scratch, "SELECT count(*) FROM notifications") == 0

    await _run(scratch, NOTIFICATIONS, "downgrade")
    assert await _tables(scratch) == 0


async def test_the_index_revision_upgrades_and_downgrades(scratch):
    await _run(scratch, UNSETTLED_INDEX, "upgrade")
    assert await _index_is_valid(scratch) is True

    await _run(scratch, UNSETTLED_INDEX, "downgrade")
    assert await _index_is_valid(scratch) is None


async def test_the_index_revision_replaces_an_interrupted_build(scratch):
    async with scratch.connect() as connection:
        await connection.execute(
            text(f"CREATE INDEX {INDEX_NAME} ON trigger_deliveries (id)")
        )
        await connection.execute(
            text(
                "UPDATE pg_index SET indisvalid = false "
                "WHERE indexrelid = CAST(:name AS regclass)"
            ),
            {"name": INDEX_NAME},
        )
    assert await _index_is_valid(scratch) is False

    await _run(scratch, UNSETTLED_INDEX, "upgrade")

    assert await _index_is_valid(scratch) is True
    definition = await _value(
        scratch,
        "SELECT indexdef FROM pg_indexes WHERE indexname = :name",
        name=INDEX_NAME,
    )
    assert "(created_at, id)" in definition
