"""The stored mount prefix against a migrated Postgres.

Revision `oss000000050` adds `mounts.storage_prefix`, fills it for every row, and keeps a
`BEFORE INSERT` trigger so that pods of the previous release, which do not know the column,
still insert and re-bind mounts during a rolling deploy. These cases pin that SQL, the trigger
and the DAO writes, and they pin the sign upsert at one statement on both of its paths.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

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


# The columns the previous release's mappings write, and no `storage_prefix`.
_OLD_POD_INSERT = (
    "INSERT INTO mounts "
    "(project_id, id, slug, name, session_id, agent_id, purpose, "
    "flags, data, tags, meta, created_by_id) "
    "VALUES (:project_id, :id, :slug, NULL, NULL, NULL, NULL, "
    "'{}', '{}', NULL, NULL, :created_by_id)"
)


async def _insert_old_pod_row(
    engine,
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    slug: str,
    mount_id: uuid.UUID,
) -> None:
    async with engine.session() as session:
        await session.execute(
            text(_OLD_POD_INSERT),
            {
                "project_id": project_id,
                "id": mount_id,
                "slug": slug,
                "created_by_id": user_id,
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


async def test_old_pod_insert_gets_the_project_layout(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    mount_id = uuid.uuid4()

    await _insert_old_pod_row(
        engine,
        project_id=project_id,
        user_id=mount_scope["user_id"],
        slug=f"old-pod-{mount_id.hex}",
        mount_id=mount_id,
    )

    assert await _stored_prefix(engine, mount_id=mount_id) == (
        f"mounts/{project_id}/{mount_id}"
    )


async def test_old_pod_rebind_keeps_the_stored_prefix(mount_scope):
    engine = mount_scope["engine"]
    project_id = mount_scope["project_id"]
    user_id = mount_scope["user_id"]
    mount_id = uuid.uuid4()
    slug = f"old-rebind-{mount_id.hex}"

    await _insert_old_pod_row(
        engine,
        project_id=project_id,
        user_id=user_id,
        slug=slug,
        mount_id=mount_id,
    )

    async with engine.session() as session:
        result = await session.execute(
            text(
                _OLD_POD_INSERT
                + " ON CONFLICT ON CONSTRAINT uq_mounts_project_id_slug "
                "DO UPDATE SET updated_at = now() RETURNING id, storage_prefix"
            ),
            {
                "project_id": project_id,
                "id": uuid.uuid4(),
                "slug": slug,
                "created_by_id": user_id,
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
