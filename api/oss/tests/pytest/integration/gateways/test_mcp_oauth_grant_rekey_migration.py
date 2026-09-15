"""The data migration that moves stored MCP OAuth grants onto the connection key.

Runs `oss000000032`'s own `upgrade()` against a real Postgres, over a scratch database
holding the two tables it touches with the columns it reads and writes. Real SQL,
because the migration is SQL: window functions, a unique index on `(project_id, slug)`
and an `ON DELETE SET NULL` foreign key are the things it relies on, and none of them
exist in a fake.

A scratch database rather than the deployment's own, because the migration rewrites and
deletes rows across every project it finds, which is exactly what a test must not do to
a database somebody is using.

The seeded shapes mirror what the deployment actually holds: grants owned by one
connection, one grant claimed by several connections at the same server URL, and a grant
already orphaned before this ran.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import create_async_engine

from oss.tests.pytest.utils.postgres import resolve_core_uri

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

_REVISION_PATH = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000032_rekey_mcp_oauth_grants_by_connection.py"
)

_SCHEMA = """
CREATE TABLE secrets (
    id UUID PRIMARY KEY,
    project_id UUID,
    slug VARCHAR,
    kind VARCHAR NOT NULL
);
CREATE UNIQUE INDEX uq_secrets_project_id_slug
    ON secrets (project_id, slug) WHERE slug IS NOT NULL;
CREATE TABLE mcps_endpoints (
    id UUID NOT NULL,
    project_id UUID NOT NULL,
    slug VARCHAR NOT NULL,
    auth_mode VARCHAR NOT NULL,
    secret_id UUID REFERENCES secrets (id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (project_id, id)
);
"""


def _load_revision():
    """Import the revision file by path; `versions/` is not an importable package."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("_rekey_revision", _REVISION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _expected_slug(endpoint_id: uuid.UUID) -> str:
    """`get_slug_from_name_and_id("oauth-grant", endpoint_id)`, restated here.

    Deliberately not imported: if the helper and the migration's SQL ever disagree, a
    test that calls the helper for both sides cannot see it.
    """
    return f"oauth-grant-{endpoint_id.hex[-12:]}"


@pytest.fixture
async def scratch_engine():
    """A database of this test's own, created and dropped around it.

    Not the deployment's: the migration rewrites and deletes rows across every project
    it finds, which is exactly what a test must not do to a database somebody is using.
    """
    core_uri = resolve_core_uri()
    if core_uri is None:
        pytest.skip("Postgres not reachable — skipping the grant rekey migration test")

    database = f"agenta_rekey_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(core_uri, isolation_level="AUTOCOMMIT")
    async with admin.connect() as connection:
        await connection.execute(sa.text(f'CREATE DATABASE "{database}"'))
    await admin.dispose()

    engine = create_async_engine(core_uri.rsplit("/", 1)[0] + f"/{database}")
    try:
        async with engine.begin() as connection:
            for statement in filter(None, (s.strip() for s in _SCHEMA.split(";"))):
                await connection.execute(sa.text(statement))
        yield engine
    finally:
        await engine.dispose()
        admin = create_async_engine(core_uri, isolation_level="AUTOCOMMIT")
        async with admin.connect() as connection:
            await connection.execute(
                sa.text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": database},
            )
            await connection.execute(sa.text(f'DROP DATABASE IF EXISTS "{database}"'))
        await admin.dispose()


async def _seed_grant(connection, *, project_id, slug, kind="OAUTH_GRANT") -> uuid.UUID:
    secret_id = uuid.uuid4()
    await connection.execute(
        sa.text(
            "INSERT INTO secrets (id, project_id, slug, kind) "
            "VALUES (:id, :project_id, :slug, :kind)"
        ),
        {"id": secret_id, "project_id": project_id, "slug": slug, "kind": kind},
    )
    return secret_id


async def _seed_connection(
    connection,
    *,
    project_id,
    slug,
    secret_id=None,
    auth_mode="OAUTH",
    deleted=False,
) -> uuid.UUID:
    endpoint_id = uuid.uuid4()
    await connection.execute(
        sa.text(
            "INSERT INTO mcps_endpoints "
            "(id, project_id, slug, auth_mode, secret_id, deleted_at) "
            "VALUES (:id, :project_id, :slug, :auth_mode, :secret_id, :deleted_at)"
        ),
        {
            "id": endpoint_id,
            "project_id": project_id,
            "slug": slug,
            "auth_mode": auth_mode,
            "secret_id": secret_id,
            "deleted_at": datetime(2026, 1, 1, tzinfo=timezone.utc)
            if deleted
            else None,
        },
    )
    return endpoint_id


def _run_upgrade(sync_connection) -> None:
    """The revision's own `upgrade()`, with `op` bound to this connection.

    Alembic's operations proxy is what `op.get_bind()` reads, so installing a context
    around the real function is how the migration under test can be the migration that
    ships rather than a copy of its SQL.
    """
    revision = _load_revision()
    context = MigrationContext.configure(sync_connection)
    with Operations.context(context):
        revision.upgrade()


async def _upgrade(engine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(_run_upgrade)


async def _slug_of(connection, secret_id):
    result = await connection.execute(
        sa.text("SELECT slug FROM secrets WHERE id = :id"), {"id": secret_id}
    )
    return result.scalar()


async def _handle_of(connection, endpoint_id):
    result = await connection.execute(
        sa.text("SELECT secret_id FROM mcps_endpoints WHERE id = :id"),
        {"id": endpoint_id},
    )
    return result.scalar()


async def _count_secret(connection, secret_id) -> int:
    result = await connection.execute(
        sa.text("SELECT count(*) FROM secrets WHERE id = :id"), {"id": secret_id}
    )
    return result.scalar()


async def test_a_grant_one_connection_owns_is_rekeyed_and_keeps_working(scratch_engine):
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        secret_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-ff8ef6b614b8"
        )
        endpoint_id = await _seed_connection(
            connection, project_id=project_id, slug="acme", secret_id=secret_id
        )

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        # The row is the same row, under the connection's key, and the connection still
        # names it. No reconnect.
        assert await _slug_of(connection, secret_id) == _expected_slug(endpoint_id)
        assert await _handle_of(connection, endpoint_id) == secret_id


async def test_a_grant_several_connections_claim_is_dropped_and_they_need_a_reconnect(
    scratch_engine,
):
    """It holds whichever consent ran last, and nothing recorded which. There is no
    honest way to hand it to one of them."""
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        secret_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-ff8ef6b614b8"
        )
        claimants = [
            await _seed_connection(
                connection,
                project_id=project_id,
                slug=f"qa-phone-{index}",
                secret_id=secret_id,
            )
            for index in range(6)
        ]

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert await _count_secret(connection, secret_id) == 0
        for endpoint_id in claimants:
            assert await _handle_of(connection, endpoint_id) is None


async def test_both_cases_in_one_project_are_resolved_independently(scratch_engine):
    """The deployment's real distribution: three grants owned outright, one claimed by
    six connections at the same server URL."""
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        owned = []
        for index in range(3):
            secret_id = await _seed_grant(
                connection, project_id=project_id, slug=f"oauth-grant-sole{index}"
            )
            endpoint_id = await _seed_connection(
                connection,
                project_id=project_id,
                slug=f"sole-{index}",
                secret_id=secret_id,
            )
            owned.append((endpoint_id, secret_id))

        shared_secret_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-shared"
        )
        claimants = [
            await _seed_connection(
                connection,
                project_id=project_id,
                slug=f"shared-{index}",
                secret_id=shared_secret_id,
            )
            for index in range(6)
        ]

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        for endpoint_id, secret_id in owned:
            assert await _slug_of(connection, secret_id) == _expected_slug(endpoint_id)
            assert await _handle_of(connection, endpoint_id) == secret_id
        for endpoint_id in claimants:
            assert await _handle_of(connection, endpoint_id) is None
        assert await _count_secret(connection, shared_secret_id) == 0


async def test_a_deleted_connection_does_not_make_a_live_ones_grant_ambiguous(
    scratch_engine,
):
    """A soft-deleted connection is not a claimant. Counting it would cost the live
    connection a working grant for nothing."""
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        secret_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-legacy"
        )
        live = await _seed_connection(
            connection, project_id=project_id, slug="live", secret_id=secret_id
        )
        await _seed_connection(
            connection,
            project_id=project_id,
            slug="gone",
            secret_id=secret_id,
            deleted=True,
        )

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert await _slug_of(connection, secret_id) == _expected_slug(live)
        assert await _handle_of(connection, live) == secret_id


async def test_a_grant_that_was_already_orphaned_is_left_alone(scratch_engine):
    """Cleaning up rows nothing ever named is not this revision's business, and deleting
    them would be a second, unannounced behaviour."""
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        orphan_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-orphan"
        )

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert await _slug_of(connection, orphan_id) == "oauth-grant-orphan"


async def test_connections_with_no_grant_and_non_oauth_connections_are_untouched(
    scratch_engine,
):
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        unconnected = await _seed_connection(
            connection, project_id=project_id, slug="unconnected"
        )
        open_server = await _seed_connection(
            connection, project_id=project_id, slug="open", auth_mode="NONE"
        )

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert await _handle_of(connection, unconnected) is None
        assert await _handle_of(connection, open_server) is None


async def test_two_projects_at_one_server_url_are_rekeyed_without_colliding(
    scratch_engine,
):
    """Every project's grant carried the same URL-derived slug, because the slug was a
    function of the URL alone. Each must land on its own connection's key."""
    first_project, second_project = uuid.uuid4(), uuid.uuid4()
    shared_old_slug = "oauth-grant-ff8ef6b614b8"
    async with scratch_engine.begin() as connection:
        first_secret = await _seed_grant(
            connection, project_id=first_project, slug=shared_old_slug
        )
        first_endpoint = await _seed_connection(
            connection, project_id=first_project, slug="acme", secret_id=first_secret
        )
        second_secret = await _seed_grant(
            connection, project_id=second_project, slug=shared_old_slug
        )
        second_endpoint = await _seed_connection(
            connection, project_id=second_project, slug="acme", secret_id=second_secret
        )

    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert await _slug_of(connection, first_secret) == _expected_slug(
            first_endpoint
        )
        assert await _slug_of(connection, second_secret) == _expected_slug(
            second_endpoint
        )
        assert await _slug_of(connection, first_secret) != await _slug_of(
            connection, second_secret
        )


async def test_running_the_migration_twice_changes_nothing_the_second_time(
    scratch_engine,
):
    """A rerun is a real possibility, and the second pass must not re-key an already
    re-keyed row onto something else or delete a grant that is now sole-owned."""
    project_id = uuid.uuid4()
    async with scratch_engine.begin() as connection:
        secret_id = await _seed_grant(
            connection, project_id=project_id, slug="oauth-grant-ff8ef6b614b8"
        )
        endpoint_id = await _seed_connection(
            connection, project_id=project_id, slug="acme", secret_id=secret_id
        )

    await _upgrade(scratch_engine)
    async with scratch_engine.connect() as connection:
        after_first = await _slug_of(connection, secret_id)
    await _upgrade(scratch_engine)

    async with scratch_engine.connect() as connection:
        assert (
            await _slug_of(connection, secret_id)
            == after_first
            == _expected_slug(endpoint_id)
        )
        assert await _handle_of(connection, endpoint_id) == secret_id
