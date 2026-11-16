"""oss000000063 adds the drive keys to agent revisions that lack them or hold null,
keeps every value a revision states, and changes nothing on a second run. Runs the
backfill on a scratch Postgres (skipped when none is reachable), on just the table it
touches."""

import asyncio
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_NAME = "agenta_agent_drives_backfill"
ADMIN_DSN = "postgresql://username:password@localhost:5444/postgres"
DATABASE_DSN = f"postgresql://username:password@localhost:5444/{DATABASE_NAME}"
SQLALCHEMY_URL = (
    f"postgresql+asyncpg://username:password@localhost:5444/{DATABASE_NAME}"
)
REVISION = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000063_backfill_agent_drives.py"
)

DEFAULTS = {"has_session_drive": True, "drives": [{"kind": "agent"}]}
AGENT = {"is_agent": True, "is_skill": False}
NOT_AGENT = {"is_agent": False, "is_skill": False}


def _revision():
    spec = importlib.util.spec_from_file_location("oss000000063", REVISION)
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
        CREATE TABLE workflow_revisions (
            project_id UUID NOT NULL, id UUID NOT NULL, flags JSONB, data JSON,
            PRIMARY KEY (project_id, id)
        )
        """
    )
    return connection


async def _drop():
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
    finally:
        await admin.close()


def _data(agent, **extra):
    return {"uri": "agenta:builtin:agent:v0", "parameters": {"agent": agent, **extra}}


async def _backfill(revision):
    engine = create_async_engine(SQLALCHEMY_URL)
    try:
        async with engine.begin() as connection:
            return await connection.run_sync(
                lambda sync: revision._backfill(sync, batch_size=2)
            )
    finally:
        await engine.dispose()


async def _run():
    revision = _revision()
    db = await _scratch()
    project = uuid4()
    harness = {"kind": "pi"}
    rows = {
        "bare": (AGENT, _data({"harness": harness}, prompt="p")),
        "no_session_drive": (
            AGENT,
            _data({"harness": harness, "has_session_drive": False}),
        ),
        "project_drives": (
            AGENT,
            _data({"drives": [{"kind": "project", "slug": "docs"}]}),
        ),
        "null_keys": (AGENT, _data({"has_session_drive": None, "drives": None})),
        "null_character": (AGENT, _data({"harness": harness}, prompt="a\u0000b")),
        "non_ascii": (AGENT, _data({"harness": harness}, prompt="café 日本")),
        "lone_surrogate": (AGENT, _data({"harness": harness}, prompt="a\ud800b")),
        "both": (AGENT, _data({"has_session_drive": True, "drives": []})),
        "not_agent": (NOT_AGENT, _data({"harness": harness})),
        "no_flags": (None, _data({"harness": harness})),
        "agent_not_object": (AGENT, _data("text")),
        "no_agent_key": (AGENT, {"parameters": {"prompt": "p"}}),
        "no_data": (AGENT, None),
    }
    ids = {name: uuid4() for name in rows}
    try:
        for name, (flags, data) in rows.items():
            await db.execute(
                "INSERT INTO workflow_revisions VALUES ($1, $2, $3, $4)",
                project,
                ids[name],
                None if flags is None else json.dumps(flags),
                None if data is None else json.dumps(data),
            )

        async def raw(name):
            return await db.fetchval(
                "SELECT data FROM workflow_revisions WHERE id = $1", ids[name]
            )

        async def snapshot():
            return {name: await raw(name) for name in rows}

        before = await snapshot()

        assert await _backfill(revision) == 7

        def data(name):
            return json.loads(after[name])

        after = await snapshot()
        assert data("bare") == _data({"harness": harness, **DEFAULTS}, prompt="p")
        # a stated value is kept; only the missing key is added
        assert data("no_session_drive")["parameters"]["agent"] == {
            "harness": harness,
            "has_session_drive": False,
            "drives": [{"kind": "agent"}],
        }
        assert data("project_drives")["parameters"]["agent"] == {
            "has_session_drive": True,
            "drives": [{"kind": "project", "slug": "docs"}],
        }
        # a stated null counts as absent
        assert data("null_keys")["parameters"]["agent"] == DEFAULTS
        # jsonb refuses a null character; the row is still merged and keeps it
        assert data("null_character") == _data(
            {"harness": harness, **DEFAULTS}, prompt="a\u0000b"
        )
        # escapes in unrelated values keep their meaning
        assert data("non_ascii") == _data(
            {"harness": harness, **DEFAULTS}, prompt="café 日本"
        )
        assert data("lone_surrogate") == _data(
            {"harness": harness, **DEFAULTS}, prompt="a\ud800b"
        )
        # rows the backfill must not touch keep their stored text
        for name in (
            "both",
            "not_agent",
            "no_flags",
            "agent_not_object",
            "no_agent_key",
            "no_data",
        ):
            assert after[name] == before[name], name

        assert await _backfill(revision) == 0
        assert await snapshot() == after
    finally:
        await db.close()
        await _drop()


def test_agent_revisions_get_the_missing_drive_keys_once():
    asyncio.run(_run())
