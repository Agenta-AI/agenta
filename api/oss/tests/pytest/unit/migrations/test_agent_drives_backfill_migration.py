"""oss000000064 gives every agent drive a readable slug and a visibility row, creates the
drives of agents that never ran, and states the drives of every agent revision. Runs the
backfill on a scratch Postgres (skipped when none is reachable), on just the tables it
touches, and checks that a second run changes nothing."""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_NAME = "agenta_agent_drives_backfill"
PORT = os.environ.get("MIGRATION_TEST_POSTGRES_PORT", "5444")
ADMIN_DSN = f"postgresql://username:password@localhost:{PORT}/postgres"
DATABASE_DSN = f"postgresql://username:password@localhost:{PORT}/{DATABASE_NAME}"
SQLALCHEMY_URL = (
    f"postgresql+asyncpg://username:password@localhost:{PORT}/{DATABASE_NAME}"
)
REVISION = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000064_backfill_agent_drives.py"
)

# The tests share one scratch database, so they must run in one xdist worker.
pytestmark = pytest.mark.xdist_group("agent_drives_backfill_migration")

AGENT = {"is_agent": True}
NOT_AGENT = {"is_agent": False}
HARNESS = {"kind": "pi"}

_SCHEMA = """
CREATE TABLE projects (id UUID PRIMARY KEY, organization_id UUID);
CREATE TABLE workflow_artifacts (
    project_id UUID NOT NULL REFERENCES projects (id), id UUID NOT NULL,
    slug VARCHAR NOT NULL, name VARCHAR, created_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
    PRIMARY KEY (project_id, id), UNIQUE (project_id, slug)
);
CREATE TABLE workflow_revisions (
    project_id UUID NOT NULL, id UUID NOT NULL, artifact_id UUID NOT NULL,
    flags JSONB, data JSON, PRIMARY KEY (project_id, id)
);
CREATE TABLE agent_access (
    project_id UUID NOT NULL, artifact_id UUID NOT NULL, visibility VARCHAR NOT NULL,
    owner_user_id UUID NOT NULL, PRIMARY KEY (project_id, artifact_id)
);
CREATE TABLE mounts (
    project_id UUID NOT NULL REFERENCES projects (id), id UUID NOT NULL,
    slug VARCHAR NOT NULL, name VARCHAR, description VARCHAR, session_id VARCHAR,
    agent_id VARCHAR, purpose VARCHAR, storage_prefix VARCHAR NOT NULL,
    data JSON, flags JSONB, tags JSONB, meta JSON,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ, created_by_id UUID, updated_by_id UUID, deleted_by_id UUID,
    PRIMARY KEY (project_id, id),
    CONSTRAINT uq_mounts_project_id_slug UNIQUE (project_id, slug)
);
CREATE UNIQUE INDEX uq_mounts_project_id_agent_id
    ON mounts (project_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE TABLE mount_visibility (
    project_id UUID NOT NULL, mount_id UUID NOT NULL, visibility VARCHAR NOT NULL,
    owner_user_id UUID, created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (project_id, mount_id),
    FOREIGN KEY (project_id, mount_id) REFERENCES mounts (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ck_mount_visibility_value CHECK (visibility IN ('private', 'project')),
    CONSTRAINT ck_mount_visibility_private_owner
        CHECK (visibility <> 'private' OR owner_user_id IS NOT NULL)
);
"""


def _revision():
    spec = importlib.util.spec_from_file_location("oss000000064", REVISION)
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
    await connection.execute(_SCHEMA)
    return connection


async def _drop():
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
    finally:
        await admin.close()


async def _backfill(revision):
    engine = create_async_engine(SQLALCHEMY_URL)
    try:
        async with engine.begin() as connection:
            return await connection.run_sync(
                lambda sync: revision._backfill(sync, batch_size=2)
            )
    finally:
        await engine.dispose()


def _reserved(artifact_id) -> str:
    return f"__ag__agent__{artifact_id}__default"


def _data(agent, **extra):
    return {"uri": "agenta:builtin:agent:v0", "parameters": {"agent": agent, **extra}}


class _Db:
    def __init__(self, connection, project, organization):
        self.connection = connection
        self.project = project
        self.organization = organization

    async def agent(self, slug, *, access=None, archived=False):
        artifact_id = uuid4()
        await self.connection.execute(
            "INSERT INTO workflow_artifacts (project_id, id, slug, name, deleted_at) "
            "VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)",
            self.project,
            artifact_id,
            slug,
            f"Agent {slug}",
            archived,
        )
        if access is not None:
            await self.connection.execute(
                "INSERT INTO agent_access VALUES ($1, $2, $3, $4)",
                self.project,
                artifact_id,
                *access,
            )
        return artifact_id

    async def drive(
        self, slug, *, agent_id=None, session_id=None, visibility=None, archived=False
    ):
        mount_id = uuid4()
        await self.connection.execute(
            "INSERT INTO mounts (project_id, id, slug, agent_id, session_id, "
            "storage_prefix, deleted_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END)",
            self.project,
            mount_id,
            slug,
            None if agent_id is None else str(agent_id),
            session_id,
            f"mounts/{self.organization}/{mount_id}",
            archived,
        )
        if visibility is not None:
            await self.connection.execute(
                "INSERT INTO mount_visibility (project_id, mount_id, visibility, "
                "owner_user_id) VALUES ($1, $2, $3, $4)",
                self.project,
                mount_id,
                *visibility,
            )
        return mount_id

    async def revision(self, artifact_id, data, flags=AGENT, *, raw=None):
        """`raw` is stored JSON text as is, for numbers that Python would rewrite."""
        revision_id = uuid4()
        await self.connection.execute(
            "INSERT INTO workflow_revisions VALUES ($1, $2, $3, $4, $5)",
            self.project,
            revision_id,
            artifact_id,
            None if flags is None else json.dumps(flags),
            raw if raw is not None else None if data is None else json.dumps(data),
        )
        return revision_id

    async def text(self, revision_id):
        return await self.connection.fetchval(
            "SELECT data::text FROM workflow_revisions WHERE id = $1", revision_id
        )

    async def data(self, revision_id):
        text = await self.connection.fetchval(
            "SELECT data::text FROM workflow_revisions WHERE id = $1", revision_id
        )
        return text if text is None else json.loads(text)

    async def mount(self, mount_id):
        return dict(
            await self.connection.fetchrow(
                "SELECT m.slug, m.agent_id, m.storage_prefix, m.name, "
                "mv.visibility, mv.owner_user_id FROM mounts m LEFT JOIN "
                "mount_visibility mv ON mv.mount_id = m.id WHERE m.id = $1",
                mount_id,
            )
        )

    async def agent_mount(self, artifact_id):
        return await self.connection.fetchval(
            "SELECT id FROM mounts WHERE agent_id = $1", str(artifact_id)
        )

    async def snapshot(self):
        tables = {}
        for table, order in (
            ("mounts", "id"),
            ("mount_visibility", "mount_id"),
            ("workflow_revisions", "id"),
        ):
            rows = await self.connection.fetch(
                f"SELECT * FROM {table} ORDER BY {order}"
            )
            tables[table] = [
                {key: str(value) for key, value in dict(row).items()} for row in rows
            ]
        return tables


async def _run():
    revision = _revision()
    connection = await _scratch()
    project, organization = uuid4(), uuid4()
    owner, other = uuid4(), uuid4()
    await connection.execute(
        "INSERT INTO projects VALUES ($1, $2)", project, organization
    )
    db = _Db(connection, project, organization)
    try:
        # a shared agent with no access row (ownerless) that ran; its slug collides
        quote = await db.agent("quote-agent")
        quote_mount = await db.drive(_reserved(quote), agent_id=quote)
        project_drive = await db.drive("quote-agent-files")
        # a second agent whose slug maps to the same readable slug
        quote_2 = await db.agent("Quote_Agent", access=("project", owner))
        quote_2_mount = await db.drive(_reserved(quote_2), agent_id=quote_2)
        # a private agent that ran
        private = await db.agent("private-agent", access=("private", owner))
        private_mount = await db.drive(_reserved(private), agent_id=private)
        # a private agent that never ran, and an archived one
        fresh = await db.agent("fresh-agent", access=("private", other))
        archived = await db.agent("old-agent", archived=True)
        # a static catalog agent (no artifact) and a session drive
        static = uuid4()
        static_mount = await db.drive(_reserved(static), agent_id=static)
        session_mount = await db.drive(
            f"__ag__session__{uuid4()}__cwd", session_id="s1"
        )
        # a release 1 drive of a shared agent, stated private before release 2
        crossed = await db.agent("crossed-agent")
        crossed_mount = await db.drive(
            "crossed-agent-files", agent_id=crossed, visibility=("private", owner)
        )
        # an active agent whose drive is archived: renamed, never filled as home
        shelved = await db.agent("shelved-agent")
        shelved_mount = await db.drive(
            _reserved(shelved), agent_id=shelved, archived=True
        )

        bare = await db.revision(quote, _data({"harness": HARNESS}, prompt="p"))
        null_keys = await db.revision(
            quote, _data({"has_session_drive": None, "drives": None})
        )
        null_character = await db.revision(
            quote, _data({"harness": HARNESS}, prompt="a\u0000b")
        )
        lone_surrogate = await db.revision(
            quote, _data({"harness": HARNESS}, prompt="café a\ud800b")
        )
        # a reference saved during release 1, in drives and home_drive
        release_1 = await db.revision(
            quote,
            _data(
                {
                    "has_session_drive": True,
                    "drives": [{"slug": _reserved(quote)}],
                    "home_drive": _reserved(quote),
                }
            ),
        )
        # another agent that reads the quote agent's drive, and states its keys
        reader = await db.revision(
            private,
            _data(
                {
                    "has_session_drive": False,
                    "drives": [
                        {"slug": _reserved(quote), "access": "read"},
                        {"slug": _reserved(static)},
                    ],
                    "home_drive": None,
                }
            ),
        )
        private_bare = await db.revision(private, _data({"harness": HARNESS}))
        quote_2_bare = await db.revision(quote_2, _data({}))
        fresh_bare = await db.revision(fresh, _data({}))
        archived_bare = await db.revision(archived, _data({}))
        crossed_bare = await db.revision(crossed, _data({}))
        shelved_bare = await db.revision(shelved, _data({}))
        stated_empty = await db.revision(
            quote, _data({"has_session_drive": True, "drives": []})
        )
        untouched = {
            "not_agent": await db.revision(quote, _data({}), flags=NOT_AGENT),
            "no_flags": await db.revision(quote, _data({}), flags=None),
            "agent_not_object": await db.revision(quote, _data("text")),
            "no_agent_key": await db.revision(quote, {"parameters": {"p": 1}}),
            "no_data": await db.revision(quote, None),
        }
        untouched_before = {name: await db.data(r) for name, r in untouched.items()}
        # a stated home_drive is kept when drives is filled, null included
        stated_home = await db.revision(quote, _data({"home_drive": None}))
        stated_before = await db.data(stated_empty)

        counts = await _backfill(revision)

        # renamed in creation order, past the project drive that holds the slug
        assert await db.mount(quote_mount) == {
            "slug": "quote-agent-files-2",
            "agent_id": str(quote),
            "storage_prefix": f"mounts/{organization}/{quote_mount}",
            "name": None,
            "visibility": "project",
            "owner_user_id": None,
        }
        assert (await db.mount(quote_2_mount))["slug"] == "quote-agent-files-3"
        assert (await db.mount(quote_2_mount))["owner_user_id"] == owner
        assert await db.mount(private_mount) == {
            "slug": "private-agent-files",
            "agent_id": str(private),
            "storage_prefix": f"mounts/{organization}/{private_mount}",
            "name": None,
            "visibility": "private",
            "owner_user_id": owner,
        }
        fresh_mount = await db.agent_mount(fresh)
        assert await db.mount(fresh_mount) == {
            "slug": "fresh-agent-files",
            "agent_id": str(fresh),
            "storage_prefix": f"mounts/{organization}/{fresh_mount}",
            "name": "Agent fresh-agent",
            "visibility": "private",
            "owner_user_id": other,
        }
        assert await db.agent_mount(archived) is None
        assert (await db.mount(project_drive))["visibility"] == "project"
        static_row = await db.mount(static_mount)
        assert static_row["slug"] == _reserved(static)
        assert static_row["visibility"] is None
        assert (await db.mount(session_mount))["visibility"] is None
        assert (await db.mount(crossed_mount))["visibility"] == "private"

        def home(slug):
            return {
                "has_session_drive": True,
                "drives": [{"slug": slug}],
                "home_drive": slug,
            }

        assert await db.data(bare) == _data(
            {"harness": HARNESS, **home("quote-agent-files-2")}, prompt="p"
        )
        assert (await db.data(null_keys))["parameters"]["agent"] == home(
            "quote-agent-files-2"
        )
        # jsonb refuses a null character; the row is still merged and keeps it
        assert await db.data(null_character) == _data(
            {"harness": HARNESS, **home("quote-agent-files-2")}, prompt="a\u0000b"
        )
        assert await db.data(lone_surrogate) == _data(
            {"harness": HARNESS, **home("quote-agent-files-2")},
            prompt="café a\ud800b",
        )
        assert (await db.data(release_1))["parameters"]["agent"] == home(
            "quote-agent-files-2"
        )
        assert (await db.data(reader))["parameters"]["agent"] == {
            "has_session_drive": False,
            "drives": [
                {"slug": "quote-agent-files-2", "access": "read"},
                {"slug": _reserved(static)},
            ],
            "home_drive": None,
        }
        assert (await db.data(private_bare))["parameters"]["agent"] == {
            "harness": HARNESS,
            **home("private-agent-files"),
        }
        assert (await db.data(quote_2_bare))["parameters"]["agent"] == home(
            "quote-agent-files-3"
        )
        assert (await db.data(fresh_bare))["parameters"]["agent"] == home(
            "fresh-agent-files"
        )
        no_drive = {"has_session_drive": True, "drives": [], "home_drive": None}
        assert (await db.data(archived_bare))["parameters"]["agent"] == no_drive
        # the home rule refuses a private drive as home of a shared agent
        assert (await db.data(crossed_bare))["parameters"]["agent"] == no_drive
        assert await db.data(stated_empty) == stated_before
        assert (await db.data(stated_home))["parameters"]["agent"] == {
            "has_session_drive": True,
            "drives": [{"slug": "quote-agent-files-2"}],
            "home_drive": None,
        }
        for name, revision_id in untouched.items():
            assert await db.data(revision_id) == untouched_before[name], name

        assert (await db.data(shelved_bare))["parameters"]["agent"] == no_drive
        assert (await db.mount(shelved_mount))["slug"] == "shelved-agent-files"
        # last, so a broken case fails on its own assertion first
        assert counts == {
            "renamed": 4,
            "created": 1,
            "agent_visibility": 5,
            "project_visibility": 1,
            "revisions": 13,
            "skipped": 0,
            "corrected": 0,
        }

        after = await db.snapshot()
        assert await _backfill(revision) == {
            "renamed": 0,
            "created": 0,
            "agent_visibility": 0,
            "project_visibility": 0,
            "revisions": 0,
            "skipped": 0,
            "corrected": 0,
        }
        assert await db.snapshot() == after
    finally:
        await connection.close()
        await _drop()


async def _run_concurrent_visibility_change():
    revision = _revision()
    connection = await _scratch()
    project, organization, owner = uuid4(), uuid4(), uuid4()
    await connection.execute(
        "INSERT INTO projects VALUES ($1, $2)", project, organization
    )
    db = _Db(connection, project, organization)
    owner_connection = await asyncpg.connect(DATABASE_DSN)
    try:
        agent = await db.agent("turned-private", access=("project", owner))
        mount = await db.drive(_reserved(agent), agent_id=agent)
        # a release 1 row that differs from its agent on purpose
        kept = await db.agent("kept-agent", access=("project", owner))
        kept_mount = await db.drive(
            "kept-agent-files", agent_id=kept, visibility=("private", owner)
        )

        async with connection.transaction():
            await connection.execute(revision._AGENT_DRIVE_VISIBILITY_SQL)
            # the owner makes the agent private while the migration runs
            await owner_connection.execute(
                "UPDATE agent_access SET visibility = 'private' "
                "WHERE project_id = $1 AND artifact_id = $2",
                project,
                agent,
            )
            status = await connection.execute(
                revision._CORRECT_AGENT_DRIVE_VISIBILITY_SQL
            )
        assert status == "UPDATE 1"

        row = await db.mount(mount)
        assert (row["visibility"], row["owner_user_id"]) == ("private", owner)
        kept_row = await db.mount(kept_mount)
        assert (kept_row["visibility"], kept_row["owner_user_id"]) == (
            "private",
            owner,
        )
    finally:
        await owner_connection.close()
        await connection.close()
        await _drop()


def test_agent_drive_visibility_follows_a_concurrent_agent_change():
    asyncio.run(_run_concurrent_visibility_change())


async def _run_stored_numbers():
    revision = _revision()
    connection = await _scratch()
    project, organization = uuid4(), uuid4()
    await connection.execute(
        "INSERT INTO projects VALUES ($1, $2)", project, organization
    )
    db = _Db(connection, project, organization)
    try:
        agent = await db.agent("number-agent")
        await db.drive(_reserved(agent), agent_id=agent)
        # Python reads these as inf, 0.0 and 1.0, so writing them back would change
        # them or fail; the revision stays as stored
        kept = {
            number: await db.revision(
                agent,
                None,
                raw='{"parameters": {"agent": {}, "threshold": %s}}' % number,
            )
            for number in ("1e400", "1e-400", "1.00000000000000000001")
        }
        kept_before = {number: await db.text(r) for number, r in kept.items()}
        # these keep their value through the round trip, so the revision is written
        exact = await db.revision(
            agent,
            None,
            raw='{"parameters": {"agent": {}, "big": 123456789012345678901234567890, '
            '"wide": 1.5e10, "tenth": 0.1, "zero": -0.0}}',
        )

        counts = await _backfill(revision)

        for number, revision_id in kept.items():
            assert await db.text(revision_id) == kept_before[number], number
        assert await db.data(exact) == {
            "parameters": {
                "agent": {
                    "has_session_drive": True,
                    "drives": [{"slug": "number-agent-files"}],
                    "home_drive": "number-agent-files",
                },
                "big": 123456789012345678901234567890,
                "wide": 1.5e10,
                "tenth": 0.1,
                "zero": -0.0,
            }
        }
        assert (counts["revisions"], counts["skipped"]) == (1, 3)
    finally:
        await connection.close()
        await _drop()


def test_stored_numbers_are_never_rewritten_with_another_value():
    asyncio.run(_run_stored_numbers())


async def _run_agent_made_private_before_the_fill():
    revision = _revision()
    connection = await _scratch()
    project, organization, owner = uuid4(), uuid4(), uuid4()
    await connection.execute(
        "INSERT INTO projects VALUES ($1, $2)", project, organization
    )
    db = _Db(connection, project, organization)
    owner_connection = await asyncpg.connect(DATABASE_DSN)
    engine = create_async_engine(SQLALCHEMY_URL)
    try:
        agent = await db.agent("late-private", access=("project", owner))
        bare = await db.revision(agent, _data({}))

        async with engine.begin() as migration:
            await migration.run_sync(
                lambda sync: (
                    revision._name_drives(sync),
                    sync.execute(sa.text(revision._AGENT_DRIVE_VISIBILITY_SQL)),
                )
            )
            # the owner makes the agent private after its drive row was written
            await owner_connection.execute(
                "UPDATE agent_access SET visibility = 'private' "
                "WHERE project_id = $1 AND artifact_id = $2",
                project,
                agent,
            )
            await migration.run_sync(
                lambda sync: (
                    revision._state_drives(sync, batch_size=2),
                    sync.execute(sa.text(revision._CORRECT_AGENT_DRIVE_VISIBILITY_SQL)),
                )
            )

        # the drive follows the agent, and the revision keeps the drive as home
        drive = await db.mount(await db.agent_mount(agent))
        assert (drive["visibility"], drive["owner_user_id"]) == ("private", owner)
        assert (await db.data(bare))["parameters"]["agent"] == {
            "has_session_drive": True,
            "drives": [{"slug": "late-private-files"}],
            "home_drive": "late-private-files",
        }
    finally:
        await engine.dispose()
        await owner_connection.close()
        await connection.close()
        await _drop()


def test_an_agent_made_private_during_the_run_keeps_its_home_drive():
    asyncio.run(_run_agent_made_private_before_the_fill())


def test_agent_drives_get_slugs_visibility_and_stated_revisions_once():
    asyncio.run(_run())


def test_drive_slug_rule():
    rule = _revision()._drive_slug
    assert rule("quote-agent", set()) == "quote-agent-files"
    assert rule("Quote_Agent v2", set()) == "quote-agent-v2-files"
    assert rule("__", set()) == "agent-files"
    assert rule("a", {"a-files", "a-files-2"}) == "a-files-3"
    # the base is cut to 60 characters, without a trailing dash
    assert rule("a" * 70, set()) == "a" * 60 + "-files"
    assert rule("a" * 59 + "-b", set()) == "a" * 59 + "-files"


def test_home_rule():
    allowed = _revision()._home_allowed
    owner, other = UUID(int=1), UUID(int=2)
    assert allowed(("project", None), ("project", None))
    assert not allowed(("project", None), ("private", owner))
    assert allowed(("private", owner), ("private", owner))
    assert not allowed(("private", owner), ("private", other))
    assert not allowed(("private", owner), ("project", None))
    assert not allowed(("project", None), None)
