"""`oss000000054` on a scratch schema of the deployment's Postgres.

The revision's `upgrade()` runs through a small `op` stand-in bound to one real connection
whose `search_path` starts with a scratch schema. The schema holds pre-M5 copies of the
three tables the revision reads (`organizations`, `projects`, `secrets`), so the real SQL
runs against real Postgres and the deployment's own tables are never touched. The
autocommit block commits and switches the connection to autocommit, as Alembic does.
"""

import logging
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import load_revision_module


pytestmark = pytest.mark.integration

REVISION = "oss000000054_add_organization_credentials.py"

_PRE_M5_TABLES = """
CREATE TABLE organizations (id UUID PRIMARY KEY);
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations (id) ON DELETE CASCADE
);
CREATE TABLE secrets (
    id UUID PRIMARY KEY,
    slug VARCHAR,
    kind public.secretkind_enum,
    data BYTEA,
    project_id UUID REFERENCES projects (id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations (id) ON DELETE CASCADE,
    name VARCHAR,
    description VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uq_secrets_project_id_slug ON secrets (project_id, slug)
    WHERE slug IS NOT NULL;
"""


class _Interrupted(Exception):
    pass


class _Op:
    """The `op` calls the revision makes, on one sync connection."""

    def __init__(self, conn, *, interrupt_before=None):
        self.conn = conn
        self.interrupt_before = interrupt_before

    def execute(self, statement):
        statement = str(statement)
        if self.interrupt_before and self.interrupt_before in statement:
            raise _Interrupted(statement)
        self.conn.execute(text(statement))

    def get_bind(self):
        return self.conn

    def get_context(self):
        conn = self.conn

        @contextmanager
        def autocommit_block():
            conn.commit()
            conn.execution_options(isolation_level="AUTOCOMMIT")
            try:
                yield
            finally:
                conn.commit()
                conn.execution_options(isolation_level="READ COMMITTED")

        return SimpleNamespace(autocommit_block=autocommit_block)


@pytest.fixture
async def scratch():
    schema = f"m5mig_{uuid4().hex[:10]}"
    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.execute(text(f"CREATE SCHEMA {schema}"))
        await connection.execute(text(f"SET search_path TO {schema}, public"))
        for statement in _PRE_M5_TABLES.split(";"):
            if statement.strip():
                await connection.execute(text(statement))
        await connection.commit()
        await connection.execution_options(isolation_level="READ COMMITTED")
        try:
            yield SimpleNamespace(connection=connection, schema=schema)
        finally:
            await connection.rollback()
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            await connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            await connection.execute(text("RESET search_path"))


async def _upgrade(scratch, **op_kwargs):
    module = load_revision_module(REVISION)

    def run(sync_conn):
        module.op = _Op(sync_conn, **op_kwargs)
        try:
            module.upgrade()
            sync_conn.commit()
        except BaseException:
            sync_conn.rollback()
            raise

    await scratch.connection.run_sync(run)


async def _downgrade(scratch):
    module = load_revision_module(REVISION)

    def run(sync_conn):
        module.op = _Op(sync_conn)
        try:
            module.downgrade()
            sync_conn.commit()
        except BaseException:
            sync_conn.rollback()
            raise

    await scratch.connection.run_sync(run)


async def _scalar(scratch, sql, params=None):
    result = await scratch.connection.execute(text(sql), params or {})
    value = result.scalar()
    await scratch.connection.commit()
    return value


async def _exec(scratch, sql, params=None):
    await scratch.connection.execute(text(sql), params or {})
    await scratch.connection.commit()


async def _organization_and_project(scratch):
    organization_id, project_id = uuid4(), uuid4()
    await _exec(
        scratch, "INSERT INTO organizations (id) VALUES (:o)", {"o": organization_id}
    )
    await _exec(
        scratch,
        "INSERT INTO projects (id, organization_id) VALUES (:p, :o)",
        {"p": project_id, "o": organization_id},
    )
    return organization_id, project_id


async def _secret(
    scratch, *, project_id=None, organization_id=None, slug=None, kind="PROVIDER_KEY"
):
    secret_id = uuid4()
    await _exec(
        scratch,
        "INSERT INTO secrets (id, slug, kind, data, project_id, organization_id) "
        "VALUES (:id, :slug, CAST(:kind AS public.secretkind_enum), 'x', :p, :o)",
        {
            "id": secret_id,
            "slug": slug,
            "kind": kind,
            "p": project_id,
            "o": organization_id,
        },
    )
    return secret_id


async def _count(scratch, where="TRUE"):
    return await _scalar(scratch, f"SELECT count(*) FROM secrets WHERE {where}")


async def _has_column(scratch):
    return await _scalar(
        scratch,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = :s "
        "AND table_name = 'secrets' AND column_name = 'availability'",
        {"s": scratch.schema},
    )


async def _validated(scratch, name):
    return await _scalar(
        scratch,
        "SELECT convalidated FROM pg_constraint WHERE conname = :n "
        "AND conrelid = to_regclass('secrets')",
        {"n": name},
    )


async def _index_valid(scratch, name):
    # Schema-qualified: the deployment's own `public` copy of the index must not answer.
    return await _scalar(
        scratch,
        "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:n)",
        {"n": f"{scratch.schema}.{name}"},
    )


async def test_upgrade_deletes_orphans_and_logs_the_count(scratch, caplog):
    organization_id, project_id = await _organization_and_project(scratch)
    await _secret(scratch, project_id=project_id, slug="kept")
    await _secret(scratch, organization_id=organization_id, kind="SSO_PROVIDER")
    await _secret(scratch)
    await _secret(scratch)

    with caplog.at_level(logging.INFO, logger="alembic.runtime.migration"):
        await _upgrade(scratch)

    assert await _count(scratch) == 2
    assert any("deleted 2 rows with no owner" in r.getMessage() for r in caplog.records)
    assert await _validated(scratch, "ck_secrets_single_owner") is True
    assert await _validated(scratch, "ck_secrets_availability") is True
    assert await _index_valid(scratch, "uq_secrets_organization_id_slug") is True
    assert await _index_valid(scratch, "ix_secrets_organization_id") is True
    assert (
        await _scalar(scratch, "SELECT availability FROM secrets WHERE slug = 'kept'")
        == "all_projects"
    )


async def test_upgrade_stops_on_a_row_with_both_owners(scratch):
    organization_id, project_id = await _organization_and_project(scratch)
    await _secret(scratch, project_id=project_id, organization_id=organization_id)
    await _secret(scratch)

    with pytest.raises(RuntimeError, match="name a project and an organization"):
        await _upgrade(scratch)

    assert await _has_column(scratch) == 0
    assert await _count(scratch, "project_id IS NULL AND organization_id IS NULL") == 1


async def test_upgrade_stops_on_duplicate_organization_slugs(scratch):
    organization_id, _ = await _organization_and_project(scratch)
    await _secret(scratch, organization_id=organization_id, slug="openai-company")
    await _secret(scratch, organization_id=organization_id, slug="openai-company")
    await _secret(scratch)

    with pytest.raises(RuntimeError, match="organization slugs are used twice"):
        await _upgrade(scratch)

    assert await _has_column(scratch) == 0
    assert await _count(scratch, "project_id IS NULL AND organization_id IS NULL") == 1


async def test_interrupted_after_the_first_phase_then_rerun(scratch):
    organization_id, project_id = await _organization_and_project(scratch)
    await _secret(scratch, project_id=project_id, slug="kept")
    await _secret(scratch)

    with pytest.raises(_Interrupted):
        await _upgrade(scratch, interrupt_before="CREATE UNIQUE INDEX CONCURRENTLY")

    # The first phase is committed: the column, the table, the delete, NOT VALID checks.
    assert await _has_column(scratch) == 1
    assert await _count(scratch) == 1
    assert await _validated(scratch, "ck_secrets_single_owner") is False
    assert await _index_valid(scratch, "uq_secrets_organization_id_slug") is None

    await _upgrade(scratch)

    assert await _validated(scratch, "ck_secrets_single_owner") is True
    assert await _index_valid(scratch, "uq_secrets_organization_id_slug") is True
    assert await _index_valid(scratch, "ix_secrets_organization_id") is True


async def test_invalid_index_is_dropped_and_rebuilt_on_rerun(scratch):
    await _upgrade(scratch)
    for name in ("uq_secrets_organization_id_slug", "ix_secrets_organization_id"):
        await _exec(
            scratch,
            "UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(:n)",
            {"n": f"{scratch.schema}.{name}"},
        )
        assert await _index_valid(scratch, name) is False

    await _upgrade(scratch)

    assert await _index_valid(scratch, "uq_secrets_organization_id_slug") is True
    assert await _index_valid(scratch, "ix_secrets_organization_id") is True


async def test_upgrade_is_rerunnable(scratch):
    await _upgrade(scratch)
    await _upgrade(scratch)
    assert await _validated(scratch, "ck_secrets_single_owner") is True


async def test_constraint_rejects_a_new_orphan_row(scratch):
    await _upgrade(scratch)
    with pytest.raises(IntegrityError, match="ck_secrets_single_owner"):
        await _secret(scratch)
    await scratch.connection.rollback()


async def test_unique_index_rejects_a_duplicate_organization_slug(scratch):
    await _upgrade(scratch)
    organization_id, _ = await _organization_and_project(scratch)
    await _secret(scratch, organization_id=organization_id, slug="openai-company")
    with pytest.raises(IntegrityError, match="uq_secrets_organization_id_slug"):
        await _secret(scratch, organization_id=organization_id, slug="openai-company")
    await scratch.connection.rollback()


async def test_project_slug_index_unchanged_and_sso_rows_without_slug_accepted(scratch):
    await _upgrade(scratch)
    organization_id, project_id = await _organization_and_project(scratch)
    other_organization, other_project = await _organization_and_project(scratch)
    # The same slug in a project and in its organization: two slug spaces.
    await _secret(scratch, project_id=project_id, slug="openai-company")
    await _secret(scratch, organization_id=organization_id, slug="openai-company")
    await _secret(scratch, project_id=other_project, slug="openai-company")
    await _secret(scratch, organization_id=other_organization, slug="openai-company")
    # Several SSO rows of one organization, no slug.
    await _secret(scratch, organization_id=organization_id, kind="SSO_PROVIDER")
    await _secret(scratch, organization_id=organization_id, kind="SSO_PROVIDER")
    with pytest.raises(IntegrityError, match="uq_secrets_project_id_slug"):
        await _secret(scratch, project_id=project_id, slug="openai-company")
    await scratch.connection.rollback()


async def test_secret_projects_cascades_on_project_and_secret_delete(scratch):
    await _upgrade(scratch)
    organization_id, project_id = await _organization_and_project(scratch)
    _, second_project = await _organization_and_project(scratch)
    secret_id = await _secret(scratch, organization_id=organization_id, slug="limited")
    for project in (project_id, second_project):
        await _exec(
            scratch,
            "INSERT INTO secret_projects (secret_id, project_id) VALUES (:s, :p)",
            {"s": secret_id, "p": project},
        )

    await _exec(scratch, "DELETE FROM projects WHERE id = :p", {"p": project_id})
    assert await _scalar(scratch, "SELECT count(*) FROM secret_projects") == 1

    await _exec(scratch, "DELETE FROM secrets WHERE id = :s", {"s": secret_id})
    assert await _scalar(scratch, "SELECT count(*) FROM secret_projects") == 0


async def test_availability_check_rejects_an_unknown_value(scratch):
    await _upgrade(scratch)
    organization_id, _ = await _organization_and_project(scratch)
    secret_id = await _secret(scratch, organization_id=organization_id, slug="a")
    with pytest.raises(DBAPIError, match="ck_secrets_availability"):
        await _exec(
            scratch,
            "UPDATE secrets SET availability = 'everyone' WHERE id = :s",
            {"s": secret_id},
        )
    await scratch.connection.rollback()


async def test_a_rollback_never_widens_a_limited_organization_connection(scratch):
    await _upgrade(scratch)
    organization_id, project_a = await _organization_and_project(scratch)
    project_b = uuid4()
    await _exec(
        scratch,
        "INSERT INTO projects (id, organization_id) VALUES (:p, :o)",
        {"p": project_b, "o": organization_id},
    )
    limited = await _secret(scratch, organization_id=organization_id, slug="limited")
    await _exec(
        scratch,
        "UPDATE secrets SET availability = 'selected_projects' WHERE id = :s",
        {"s": limited},
    )
    await _exec(
        scratch,
        "INSERT INTO secret_projects (secret_id, project_id) VALUES (:s, :p)",
        {"s": limited, "p": project_a},
    )
    login = await _secret(
        scratch,
        organization_id=organization_id,
        slug="chatgpt",
        kind="SUBSCRIPTION_PROVIDER",
    )
    sso = await _secret(scratch, organization_id=organization_id, kind="SSO_PROVIDER")
    project_key = await _secret(scratch, project_id=project_a, slug="openai")

    await _downgrade(scratch)
    assert not await _has_column(scratch)
    remaining = await _scalar(scratch, "SELECT array_agg(id ORDER BY id) FROM secrets")
    assert sorted(remaining) == sorted([sso, project_key])
    assert limited not in remaining and login not in remaining

    # Upgraded again, no organization connection is offered to project B.
    await _upgrade(scratch)
    offered_to_b = await _scalar(
        scratch,
        "SELECT count(*) FROM secrets s WHERE s.project_id IS NULL "
        "AND s.organization_id = :o AND s.kind <> 'SSO_PROVIDER' "
        "AND (s.availability = 'all_projects' OR EXISTS (SELECT 1 FROM secret_projects sp "
        "WHERE sp.secret_id = s.id AND sp.project_id = :b))",
        {"o": organization_id, "b": project_b},
    )
    assert offered_to_b == 0
    assert await _count(scratch, "kind = 'SSO_PROVIDER'") == 1
