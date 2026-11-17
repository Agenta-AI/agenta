"""oss000000064 gives every agent drive a readable slug and a visibility row, creates the
drives of agents that never ran, and states the drives of every agent revision. Runs the
backfill on a scratch Postgres (skipped when none is reachable), on just the tables it
touches, and checks that a second run changes nothing."""

import asyncio
import importlib.util
import json
from pathlib import Path
from uuid import UUID, uuid4

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
    / "oss000000064_backfill_agent_drives.py"
)

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

    async def drive(self, slug, *, agent_id=None, session_id=None, visibility=None):
        mount_id = uuid4()
        await self.connection.execute(
            "INSERT INTO mounts (project_id, id, slug, agent_id, session_id, "
            "storage_prefix) VALUES ($1, $2, $3, $4, $5, $6)",
            self.project,
            mount_id,
            slug,
            None if agent_id is None else str(agent_id),
            session_id,
            f"mounts/{self.organization}/{mount_id}",
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

    async def revision(self, artifact_id, data, flags=AGENT):
        revision_id = uuid4()
        await self.connection.execute(
            "INSERT INTO workflow_revisions VALUES ($1, $2, $3, $4, $5)",
            self.project,
            revision_id,
            artifact_id,
            None if flags is None else json.dumps(flags),
            None if data is None else json.dumps(data),
        )
        return revision_id

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
        stated_before = await db.data(stated_empty)

        counts = await _backfill(revision)
        assert counts == {
            "renamed": 3,
            "created": 1,
            "agent_visibility": 4,
            "project_visibility": 1,
            "revisions": 11,
        }

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
        for name, revision_id in untouched.items():
            assert await db.data(revision_id) == untouched_before[name], name

        after = await db.snapshot()
        assert await _backfill(revision) == {
            "renamed": 0,
            "created": 0,
            "agent_visibility": 0,
            "project_visibility": 0,
            "revisions": 0,
        }
        assert await db.snapshot() == after
    finally:
        await connection.close()
        await _drop()


def test_agent_drives_get_slugs_visibility_and_stated_revisions_once():
    asyncio.run(_run())


def test_drive_slug_rule():
    rule = _revision()._drive_slug
    assert rule("quote-agent", set()) == "quote-agent-files"
    assert rule("Quote_Agent v2", set()) == "quote-agent-v2-files"
    assert rule("__", set()) == "agent-files"
    assert rule("a", {"a-files", "a-files-2"}) == "a-files-3"


def test_home_rule():
    allowed = _revision()._home_allowed
    owner, other = UUID(int=1), UUID(int=2)
    assert allowed(("project", None), ("project", None))
    assert not allowed(("project", None), ("private", owner))
    assert allowed(("private", owner), ("private", owner))
    assert not allowed(("private", owner), ("private", other))
    assert not allowed(("private", owner), ("project", None))
    assert not allowed(("project", None), None)
