"""`oss000000048`: the sharing schema, its check constraint, and a safe rerun.

None of these tests changes the shared stack database:

- The rerun test runs the real `upgrade()` twice, through Alembic's own operations, in a
  scratch schema that is created and dropped inside one rolled-back transaction. The
  scratch schema holds copies of the tables the revision alters, indexes or references
  (`projects`, `users`, `workflow_artifacts`, `session_streams`, `channel_threads`),
  with `session_streams` and `channel_threads` in their pre-revision shape. `search_path` puts the scratch schema first, so the
  revision's unqualified names hit the copies. The autocommit block cannot commit inside
  the test transaction, so the test runs its statements in place and drops the
  `CONCURRENTLY` keyword there (PostgreSQL refuses it inside a transaction block).
- The constraint test inserts into temp-table copies of the migrated tables
  (`LIKE ... INCLUDING ALL` copies the check constraints and NOT NULL), then rolls back.

The stack database must be at `oss000000048` or later.
"""

from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import load_revision_module


pytestmark = pytest.mark.integration

REVISION = "oss000000048_add_agent_session_sharing.py"

# Tables the revision alters (session_streams) or references with a foreign key.
_SHADOWED = ("projects", "users", "workflow_artifacts", "session_streams")
# Tables the revision only indexes: copied without their indexes (the pre-revision
# shape), so the build never reaches the shared table.
_INDEXED = ("channel_threads",)


@asynccontextmanager
async def _rolled_back_connection():
    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


class _InTransactionOp:
    """Alembic's operations on the test connection, with the autocommit block run in
    place. Everything else is the real `op`."""

    def __init__(self, operations: Operations):
        self._operations = operations
        self._in_block = False

    def __getattr__(self, name):
        return getattr(self._operations, name)

    def execute(self, statement, *args, **kwargs):
        statement = str(statement)
        if self._in_block:
            statement = statement.replace("CONCURRENTLY ", "")
        return self._operations.execute(statement, *args, **kwargs)

    def get_context(self):
        @contextmanager
        def autocommit_block():
            self._in_block = True
            try:
                yield
            finally:
                self._in_block = False

        return SimpleNamespace(autocommit_block=autocommit_block)


def _upgrade(sync_connection) -> None:
    module = load_revision_module(REVISION)
    context = MigrationContext.configure(connection=sync_connection)
    module.op = _InTransactionOp(Operations(context))
    module.upgrade()


async def _snapshot(connection, schema: str) -> dict:
    """Every column, constraint and index of the scratch schema."""

    columns = (
        await connection.execute(
            text(
                "SELECT table_name, column_name, data_type, is_nullable, "
                "column_default FROM information_schema.columns "
                "WHERE table_schema = :schema ORDER BY table_name, column_name"
            ),
            {"schema": schema},
        )
    ).all()
    constraints = (
        await connection.execute(
            text(
                "SELECT c.conrelid::regclass::text, c.conname, c.convalidated, "
                "pg_catalog.pg_get_constraintdef(c.oid) "
                "FROM pg_catalog.pg_constraint c "
                "JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace "
                "WHERE n.nspname = :schema ORDER BY 1, 2"
            ),
            {"schema": schema},
        )
    ).all()
    indexes = (
        await connection.execute(
            text(
                "SELECT i.indexname, i.indexdef, x.indisvalid "
                "FROM pg_catalog.pg_indexes i "
                "JOIN pg_catalog.pg_index x "
                "  ON x.indexrelid = (quote_ident(i.schemaname) || '.' || "
                "     quote_ident(i.indexname))::regclass "
                "WHERE i.schemaname = :schema ORDER BY i.indexname"
            ),
            {"schema": schema},
        )
    ).all()
    return {
        "columns": [tuple(row) for row in columns],
        "constraints": [tuple(row) for row in constraints],
        "indexes": [tuple(row) for row in indexes],
    }


async def test_schema_revision_is_rerunnable():
    schema = f"sharing_rerun_{uuid4().hex[:12]}"
    async with _rolled_back_connection() as connection:
        await connection.execute(text(f"CREATE SCHEMA {schema}"))
        await connection.execute(text(f"SET LOCAL search_path = {schema}, public"))
        for table in _SHADOWED:
            await connection.execute(
                text(
                    f"CREATE TABLE {schema}.{table} (LIKE public.{table} INCLUDING ALL)"
                )
            )
        for table in _INDEXED:
            await connection.execute(
                text(
                    f"CREATE TABLE {schema}.{table} (LIKE public.{table} "
                    "INCLUDING DEFAULTS INCLUDING CONSTRAINTS)"
                )
            )
        # The pre-revision shape: dropping the columns also drops the copied check
        # constraint and index that involve them.
        await connection.execute(
            text(
                f"ALTER TABLE {schema}.session_streams "
                "DROP COLUMN IF EXISTS visibility, "
                "DROP COLUMN IF EXISTS owner_user_id"
            )
        )
        before = await _snapshot(connection, schema)
        assert not any(
            name in ("visibility", "owner_user_id")
            for table, name, *_ in before["columns"]
            if table == "session_streams"
        )

        await connection.run_sync(_upgrade)
        first = await _snapshot(connection, schema)

        await connection.run_sync(_upgrade)
        second = await _snapshot(connection, schema)

    assert first == second

    tables = {table for table, *_ in first["columns"]}
    assert {"agent_access", "session_grants"} <= tables
    stream_columns = {
        name: nullable
        for table, name, _, nullable, _ in first["columns"]
        if table == "session_streams"
    }
    assert stream_columns["visibility"] == "YES"
    assert stream_columns["owner_user_id"] == "YES"

    constraints = {name: validated for _, name, validated, _ in first["constraints"]}
    assert constraints["ck_session_streams_visibility_owner"] is True
    assert "ck_agent_access_visibility" in constraints
    assert "ck_session_grants_role" in constraints

    indexes = {name: valid for name, _, valid in first["indexes"]}
    for name in (
        "ix_session_streams_project_id_owner_user_id",
        "ix_agent_access_project_id_owner_user_id",
        "ix_session_grants_project_id_user_id",
        "ix_channel_threads_project_id_session_id",
    ):
        assert indexes[name] is True


async def test_migrated_database_has_the_valid_constraint_and_index():
    async with _rolled_back_connection() as connection:
        validated = (
            await connection.execute(
                text(
                    "SELECT convalidated FROM pg_catalog.pg_constraint "
                    "WHERE conname = 'ck_session_streams_visibility_owner' "
                    "AND conrelid = 'public.session_streams'::regclass"
                )
            )
        ).scalar()
        valid = [
            (
                await connection.execute(
                    text(
                        "SELECT indisvalid FROM pg_catalog.pg_index WHERE indexrelid = "
                        "pg_catalog.to_regclass(:name)"
                    ),
                    {"name": f"public.{name}"},
                )
            ).scalar()
            for name in (
                "ix_session_streams_project_id_owner_user_id",
                "ix_channel_threads_project_id_session_id",
            )
        ]
    assert validated is True
    assert valid == [True, True]


async def _insert_stream(connection, *, visibility, owner_user_id):
    await connection.execute(
        text(
            "INSERT INTO session_streams (project_id, id, session_id, visibility, "
            "owner_user_id) VALUES (:p, :id, :s, :v, :o)"
        ),
        {
            "p": uuid4(),
            "id": uuid4(),
            "s": f"s-{uuid4().hex}",
            "v": visibility,
            "o": owner_user_id,
        },
    )


async def test_schema_accepts_policy_and_rejects_private_without_owner():
    async with _rolled_back_connection() as connection:
        for table in ("session_streams", "agent_access"):
            await connection.execute(
                text(
                    f"CREATE TEMP TABLE {table} "
                    f"(LIKE public.{table} INCLUDING ALL) ON COMMIT DROP"
                )
            )

        # Accepted: a legacy row, an ownerless project row, an owned private row.
        await _insert_stream(connection, visibility=None, owner_user_id=None)
        await _insert_stream(connection, visibility="project", owner_user_id=None)
        await _insert_stream(connection, visibility="private", owner_user_id=uuid4())

        savepoint = await connection.begin_nested()
        with pytest.raises(IntegrityError) as private_without_owner:
            await _insert_stream(connection, visibility="private", owner_user_id=None)
        await savepoint.rollback()
        assert "ck_session_streams_visibility_owner" in str(private_without_owner.value)

        savepoint = await connection.begin_nested()
        with pytest.raises(IntegrityError) as unknown_visibility:
            await _insert_stream(connection, visibility="public", owner_user_id=None)
        await savepoint.rollback()
        assert "ck_session_streams_visibility_owner" in str(unknown_visibility.value)

        savepoint = await connection.begin_nested()
        with pytest.raises(IntegrityError) as agent_without_owner:
            await connection.execute(
                text(
                    "INSERT INTO agent_access (project_id, artifact_id, visibility, "
                    "owner_user_id) VALUES (:p, :a, 'project', NULL)"
                ),
                {"p": uuid4(), "a": uuid4()},
            )
        await savepoint.rollback()
        assert "owner_user_id" in str(agent_without_owner.value)
