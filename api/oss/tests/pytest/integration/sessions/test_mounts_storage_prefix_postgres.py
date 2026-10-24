"""The stored mount prefix against a migrated Postgres.

Revision `oss000000050` adds `mounts.storage_prefix` and fills it for every row. Revision
`oss000000051` drops the `BEFORE INSERT` fill trigger of 050: every pod of the release before
writes the prefix itself, so an insert without it is refused. These cases pin that SQL, the
inserts and re-binds of those pods on the new schema, the DAO writes, and the sign upsert at
one statement on both of its paths.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from oss.src.core.mounts.dtos import MountCreate
from oss.src.core.mounts.types import project_storage_prefix
from oss.src.dbs.postgres.mounts.dao import MountsDAO

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401


pytestmark = pytest.mark.integration

_REVISION_PATH = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000050_add_mounts_storage_prefix.py"
)


def _revision_constant(name: str) -> str:
    spec = importlib.util.spec_from_file_location("oss000000050", _REVISION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, name)


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Dispose before dropping the reference, or the previous engine's pooled connections leak.
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def mount_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "mount-prefix-test",
                "email": f"mount-prefix-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "mount-prefix-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "mount-prefix-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "mount-prefix-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    yield {
        "engine": engine,
        "organization_id": organization_id,
        "project_id": project_id,
        "user_id": user_id,
    }

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM mounts WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


# The columns that pods older than the stored prefix write: no `storage_prefix`.
_PRE_PREFIX_INSERT = (
    "INSERT INTO mounts "
    "(project_id, id, slug, name, session_id, agent_id, purpose, "
    "flags, data, tags, meta, created_by_id) "
    "VALUES (:project_id, :id, :slug, NULL, NULL, NULL, NULL, "
    "'{}', '{}', NULL, NULL, :created_by_id)"
)

# The columns that pods of the release before write: the project layout, explicitly.
_PROJECT_LAYOUT_INSERT = (
    "INSERT INTO mounts "
    "(project_id, id, slug, name, session_id, agent_id, purpose, "
    "flags, data, tags, meta, created_by_id, storage_prefix) "
    "VALUES (:project_id, :id, :slug, NULL, NULL, NULL, NULL, "
    "'{}', '{}', NULL, NULL, :created_by_id, :storage_prefix)"
)


async def _insert_project_layout_row(
    engine,
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    slug: str,
    mount_id: uuid.UUID,
) -> None:
    async with engine.session() as session:
        await session.execute(
            text(_PROJECT_LAYOUT_INSERT),
            {
                "project_id": project_id,
                "id": mount_id,
                "slug": slug,
                "created_by_id": user_id,
                "storage_prefix": f"mounts/{project_id}/{mount_id}",
            },
        )
        await session.commit()


async def _stored_prefix(engine, *, mount_id: uuid.UUID) -> str:
    async with engine.session() as session:
        result = await session.execute(
            text("SELECT storage_prefix FROM mounts WHERE id = :id"),
            {"id": mount_id},
        )
        return result.scalar_one()


# --- revision -------------------------------------------------------------- #


async def test_backfill_sql_writes_the_project_layout():
    engine = get_transactions_engine()
    project_id, mount_id = uuid.uuid4(), uuid.uuid4()
    backfill = _revision_constant("_BACKFILL_STORAGE_PREFIX_SQL")

    async with engine.session() as session:
        # A session temp table shadows the real one in `pg_temp`.
        await session.execute(
            text(
                "CREATE TEMP TABLE mounts "
                "(project_id uuid, id uuid, storage_prefix varchar) ON COMMIT DROP"
            )
        )
        await session.execute(
            text("INSERT INTO mounts (project_id, id) VALUES (:p, :m)"),
            {"p": project_id, "m": mount_id},
        )
        await session.execute(text(backfill))
        stored = (
            await session.execute(text("SELECT storage_prefix FROM pg_temp.mounts"))
        ).scalar_one()
        again = await session.execute(text(backfill))
        await session.rollback()

    assert stored == f"mounts/{project_id}/{mount_id}"
    assert again.rowcount == 0


async def test_fill_trigger_and_function_are_gone():
    engine = get_transactions_engine()
    async with engine.session() as session:
        triggers = await session.execute(
            text(
                "SELECT tgname FROM pg_trigger "
                "WHERE tgrelid = 'mounts'::regclass "
                "AND tgname = 'trg_mounts_fill_legacy_storage_prefix'"
            )
        )
        functions = await session.execute(
            text(
                "SELECT proname FROM pg_proc "
                "WHERE proname = 'mounts_fill_legacy_storage_prefix'"
            )
        )
        assert triggers.all() == []
        assert functions.all() == []


async def test_insert_without_a_prefix_is_refused(mount_scope):
    engine = mount_scope["engine"]
    mount_id = uuid.uuid4()

    async with engine.session() as session:
        with pytest.raises(IntegrityError):
            await session.execute(
                text(_PRE_PREFIX_INSERT),
                {
                    "project_id": mount_scope["project_id"],
                    "id": mount_id,
                    "slug": f"pre-prefix-{mount_id.hex}",
                    "created_by_id": mount_scope["user_id"],
                },
            )
        await session.rollback()

    async with engine.session() as session:
        result = await session.execute(
            text("SELECT count(*) FROM mounts WHERE id = :id"), {"id": mount_id}
        )
        assert result.scalar_one() == 0


async def test_m4a_pod_insert_keeps_its_project_layout(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    mount_id = uuid.uuid4()

    await _insert_project_layout_row(
        engine,
        project_id=project_id,
        user_id=mount_scope["user_id"],
        slug=f"m4a-pod-{mount_id.hex}",
        mount_id=mount_id,
    )

    assert await _stored_prefix(engine, mount_id=mount_id) == (
        f"mounts/{project_id}/{mount_id}"
    )


async def test_m4a_pod_rebind_keeps_the_stored_prefix(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    user_id = mount_scope["user_id"]
    mount_id = uuid.uuid4()
    slug = f"m4a-rebind-{mount_id.hex}"

    await _insert_project_layout_row(
        engine,
        project_id=project_id,
        user_id=user_id,
        slug=slug,
        mount_id=mount_id,
    )

    other_id = uuid.uuid4()
    async with engine.session() as session:
        result = await session.execute(
            text(
                _PROJECT_LAYOUT_INSERT
                + " ON CONFLICT ON CONSTRAINT uq_mounts_project_id_slug "
                "DO UPDATE SET updated_at = now() RETURNING id, storage_prefix"
            ),
            {
                "project_id": project_id,
                "id": other_id,
                "slug": slug,
                "created_by_id": user_id,
                "storage_prefix": f"mounts/{project_id}/{other_id}",
            },
        )
        row = result.one()
        await session.commit()

    assert row.id == mount_id
    assert row.storage_prefix == f"mounts/{project_id}/{mount_id}"


async def test_column_is_not_null():
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_schema = current_schema() "
                "AND table_name = 'mounts' AND column_name = 'storage_prefix'"
            )
        )
        assert result.scalar_one() == "NO"


# --- DAO ------------------------------------------------------------------- #


def _count_statements(engine):
    """Record `(statement, parameters)` for every cursor execute on the engine."""
    statements = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append((statement, parameters))

    sync_engine = engine._engine.sync_engine
    event.listen(sync_engine, "before_cursor_execute", _record)
    return statements, lambda: event.remove(
        sync_engine, "before_cursor_execute", _record
    )


async def test_dao_reads_an_old_pod_row(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    mount_id = uuid.uuid4()

    await _insert_project_layout_row(
        engine,
        project_id=project_id,
        user_id=mount_scope["user_id"],
        slug=f"old-read-{mount_id.hex}",
        mount_id=mount_id,
    )

    mount = await MountsDAO(engine=engine).fetch_mount(
        project_id=project_id,
        mount_id=mount_id,
    )

    assert mount.storage_prefix == f"mounts/{project_id}/{mount_id}"


async def test_create_mount_writes_the_project_layout(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]

    statements, stop = _count_statements(engine)
    try:
        mount = await MountsDAO(engine=engine).create_mount(
            project_id=project_id,
            user_id=mount_scope["user_id"],
            mount_create=MountCreate(slug=f"create-{uuid.uuid4().hex}"),
        )
    finally:
        stop()

    assert mount.storage_prefix == project_storage_prefix(
        project_id=project_id,
        mount_id=mount.id,
    )
    assert await _stored_prefix(engine, mount_id=mount.id) == mount.storage_prefix
    # The DAO sent the prefix itself; the legacy trigger did not fill it.
    inserts = [
        parameters
        for statement, parameters in statements
        if statement.lstrip().upper().startswith("INSERT")
    ]
    assert len(inserts) == 1
    assert mount.storage_prefix in tuple(inserts[0])


async def test_upsert_writes_the_prefix_once(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    dao = MountsDAO(engine=engine)
    slug = f"upsert-{uuid.uuid4().hex}"

    first = await dao.upsert_mount(
        project_id=project_id,
        user_id=mount_scope["user_id"],
        mount_create=MountCreate(slug=slug),
    )
    second = await dao.upsert_mount(
        project_id=project_id,
        user_id=mount_scope["user_id"],
        mount_create=MountCreate(slug=slug),
    )

    expected = project_storage_prefix(project_id=project_id, mount_id=first.id)
    assert second.id == first.id
    assert first.storage_prefix == expected
    assert second.storage_prefix == expected


async def test_upsert_runs_one_statement_on_both_paths(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    user_id = mount_scope["user_id"]
    dao = MountsDAO(engine=engine)

    # Warm up the pool and the dialect so only the upsert itself is counted.
    await dao.upsert_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug=f"warm-{uuid.uuid4().hex}"),
    )

    slug = f"count-{uuid.uuid4().hex}"
    statements, stop = _count_statements(engine)
    try:
        await dao.upsert_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=MountCreate(slug=slug),
        )
        inserted = len(statements)
        await dao.upsert_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=MountCreate(slug=slug),
        )
        conflicted = len(statements) - inserted
    finally:
        stop()

    assert inserted == 1, statements
    assert conflicted == 1, statements
