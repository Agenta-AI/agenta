"""oss000000055 copies each installation's people list to every binding of that
installation, and the downgrade removes the copies. Runs the revision's SQL on a
scratch Postgres (skipped when none is reachable), on just the two tables it
touches."""

import asyncio
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

DATABASE_NAME = "agenta_m10_people_lists"
ADMIN_DSN = "postgresql://username:password@localhost:5444/postgres"
DATABASE_DSN = f"postgresql://username:password@localhost:5444/{DATABASE_NAME}"
REVISION = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000055_copy_channel_people_lists_to_bindings.py"
)


def _revision():
    spec = importlib.util.spec_from_file_location("oss000000055", REVISION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _scratch():
    try:
        admin = await asyncpg.connect(ADMIN_DSN, timeout=3)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"scratch Postgres is unavailable: {e}")
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
        await admin.execute(f'CREATE DATABASE "{DATABASE_NAME}"')
    finally:
        await admin.close()
    connection = await asyncpg.connect(DATABASE_DSN)
    await connection.execute(
        """
        CREATE TABLE channel_connections (
            project_id UUID NOT NULL, id UUID NOT NULL, data JSON,
            PRIMARY KEY (project_id, id)
        );
        CREATE TABLE channel_agents (
            project_id UUID NOT NULL, id UUID NOT NULL, connection_id UUID NOT NULL,
            data JSON, PRIMARY KEY (project_id, id)
        );
        """
    )
    return connection


async def _drop():
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
    finally:
        await admin.close()


async def _run():
    revision = _revision()
    db = await _scratch()
    project = uuid4()
    telegram, slack, empty = uuid4(), uuid4(), uuid4()
    refs = {"references": {"workflow_revision": {"id": str(uuid4())}}}
    try:
        for connection_id, data in (
            (telegram, {"allowed_senders": [8883745180, "111", " ", None]}),
            (slack, {"bot_username": "bot"}),
            (empty, {"allowed_senders": []}),
        ):
            await db.execute(
                "INSERT INTO channel_connections VALUES ($1, $2, $3)",
                project,
                connection_id,
                json.dumps(data),
            )
        bindings = {}
        for name, connection_id, data in (
            ("tg-a", telegram, refs),
            ("tg-b", telegram, refs),
            ("tg-set", telegram, {**refs, "audience": {"senders": ["999"]}}),
            ("slack", slack, refs),
            ("empty", empty, refs),
        ):
            bindings[name] = uuid4()
            await db.execute(
                "INSERT INTO channel_agents VALUES ($1, $2, $3, $4)",
                project,
                bindings[name],
                connection_id,
                json.dumps(data),
            )

        async def audience(name):
            data = json.loads(
                await db.fetchval(
                    "SELECT data FROM channel_agents WHERE id = $1", bindings[name]
                )
            )
            return data.get("audience"), data

        await db.execute(revision._COPY_SQL)
        copied = {"senders": ["8883745180", "111"]}
        assert (await audience("tg-a"))[0] == copied
        assert (await audience("tg-b"))[0] == copied
        # a binding that already has a list keeps it
        assert (await audience("tg-set"))[0] == {"senders": ["999"]}
        # no list or an empty list on the installation: nothing copied
        assert (await audience("slack"))[0] is None
        assert (await audience("empty"))[0] is None
        # the rest of the data is untouched
        assert (await audience("tg-a"))[1]["references"] == refs["references"]
        # the installation keeps its list for the previous release
        kept = json.loads(
            await db.fetchval(
                "SELECT data FROM channel_connections WHERE id = $1", telegram
            )
        )
        assert kept["allowed_senders"][0] == 8883745180

        # running it again changes nothing
        await db.execute(revision._COPY_SQL)
        assert (await audience("tg-a"))[0] == copied

        await db.execute(revision._REMOVE_SQL)
        for name in bindings:
            assert (await audience(name))[0] is None
        assert (await audience("tg-a"))[1]["references"] == refs["references"]
    finally:
        await db.close()
        await _drop()


def test_people_lists_copy_to_every_binding_and_the_downgrade_removes_them():
    asyncio.run(_run())
