"""Integration-style tests for the new WP5 DAO plumbing against a real Postgres.

Requires the core_oss migration chain applied and POSTGRES_URI_CORE pointed at that
database (same fixture shape as test_turns_dao.py). Exercises the DAO methods the
delete/archive/unarchive fan-out is built on, and were "new plumbing" per the brief
(everything else was soft-delete-only before this WP):

  - SessionInteractionsDAO.delete_by_session_id — hard delete (was soft-only via
    cancel_session_pending's status flip).
  - SessionStreamsDAO.hard_delete_by_session_id — hard delete (kill only soft-
    deletes via delete_by_session_id).
  - SessionStreamsDAO.unarchive_by_session_id / get_by_session_id_including_archived
    — the archive round-trip's reverse + confirmation read.
  - MountsDAO.delete_by_session_id — hard delete of session-bound mount rows,
    returning the deleted rows (so the service can tear down their prefixes).
"""

import uuid

import pytest
from sqlalchemy import text

from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionCreate,
    SessionInteractionKind,
    SessionInteractionQuery,
)
from oss.src.core.mounts.dtos import MountCreate
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.mounts.dao import MountsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def project():
    """Provision the minimal FK chain: user -> org -> workspace -> project."""
    engine = get_transactions_engine()

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
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
                "username": "wp5-fanout-test",
                "email": f"wp5-fanout-test-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": org_id, "name": "wp5-fanout-test-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "wp5-fanout-test-ws",
                "organization_id": org_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "wp5-fanout-test-project",
                "workspace_id": workspace_id,
                "organization_id": org_id,
            },
        )
        await session.commit()

    yield {"project_id": project_id, "user_id": user_id}

    async with engine.session() as session:
        for table in (
            "mounts",
            "session_interactions",
            "session_turns",
            "session_streams",
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE project_id = :project_id"),
                {"project_id": project_id},
            )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": org_id}
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


@pytest.fixture
def streams_dao():
    return SessionStreamsDAO(engine=get_transactions_engine())


@pytest.fixture
def interactions_dao():
    return SessionInteractionsDAO(engine=get_transactions_engine())


@pytest.fixture
def mounts_dao():
    return MountsDAO(engine=get_transactions_engine())


# ---------------------------------------------------------------------------
# SessionInteractionsDAO.delete_by_session_id — new hard delete
# ---------------------------------------------------------------------------


async def test_interactions_delete_by_session_id_hard_deletes(
    interactions_dao, project
):
    project_id = project["project_id"]
    session_id = f"wp5-interactions-{uuid.uuid4().hex[:8]}"

    for i in range(2):
        await interactions_dao.create_interaction(
            project_id=project_id,
            user_id=None,
            interaction=SessionInteractionCreate(
                project_id=project_id,
                session_id=session_id,
                token=f"token-{i}",
                kind=SessionInteractionKind.user_approval,
            ),
        )

    deleted_count = await interactions_dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert deleted_count == 2

    remaining = await interactions_dao.query_interactions(
        project_id=project_id,
        query=SessionInteractionQuery(session_id=session_id),
    )
    assert remaining == []


async def test_interactions_delete_by_session_id_scoped_to_session(
    interactions_dao, project
):
    """Deleting one session's interactions must not touch another session's rows."""
    project_id = project["project_id"]
    session_a = f"wp5-interactions-a-{uuid.uuid4().hex[:8]}"
    session_b = f"wp5-interactions-b-{uuid.uuid4().hex[:8]}"

    await interactions_dao.create_interaction(
        project_id=project_id,
        user_id=None,
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id=session_a,
            token="token-a",
            kind=SessionInteractionKind.user_approval,
        ),
    )
    await interactions_dao.create_interaction(
        project_id=project_id,
        user_id=None,
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id=session_b,
            token="token-b",
            kind=SessionInteractionKind.user_approval,
        ),
    )

    deleted_count = await interactions_dao.delete_by_session_id(
        project_id=project_id, session_id=session_a
    )
    assert deleted_count == 1

    remaining_b = await interactions_dao.query_interactions(
        project_id=project_id,
        query=SessionInteractionQuery(session_id=session_b),
    )
    assert len(remaining_b) == 1


# ---------------------------------------------------------------------------
# SessionStreamsDAO.hard_delete_by_session_id — new hard delete
# ---------------------------------------------------------------------------


async def test_streams_hard_delete_by_session_id(streams_dao, project):
    project_id = project["project_id"]
    session_id = f"wp5-streams-hard-{uuid.uuid4().hex[:8]}"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    deleted = await streams_dao.hard_delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert deleted is True

    # Hard-deleted: not even visible to the archived-inclusive read.
    row = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id, session_id=session_id
    )
    assert row is None


async def test_streams_hard_delete_is_distinct_from_soft_kill_delete(
    streams_dao, project
):
    """kill's delete_by_session_id (soft) leaves the row queryable with deleted_at
    set; hard_delete_by_session_id actually removes it. Same session, two paths."""
    project_id = project["project_id"]
    session_id = f"wp5-streams-soft-vs-hard-{uuid.uuid4().hex[:8]}"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    soft_deleted = await streams_dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert soft_deleted is True

    still_there = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id, session_id=session_id
    )
    assert still_there is not None
    assert still_there.deleted_at is not None

    hard_deleted = await streams_dao.hard_delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert hard_deleted is True

    gone = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id, session_id=session_id
    )
    assert gone is None


# ---------------------------------------------------------------------------
# SessionStreamsDAO archive/unarchive round trip
# ---------------------------------------------------------------------------


async def test_streams_archive_unarchive_round_trip(streams_dao, project):
    project_id = project["project_id"]
    session_id = f"wp5-streams-archive-{uuid.uuid4().hex[:8]}"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    archived = await streams_dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert archived is True

    # Not visible via the normal (non-archived) read.
    normal_read = await streams_dao.get_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert normal_read is None

    # Visible via the archived-inclusive read, with deleted_at set.
    archived_row = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id, session_id=session_id
    )
    assert archived_row is not None
    assert archived_row.deleted_at is not None

    unarchived_row = await streams_dao.unarchive_by_session_id(
        project_id=project_id, user_id=None, session_id=session_id
    )
    assert unarchived_row is not None
    assert unarchived_row.deleted_at is None

    # Now visible again via the normal read.
    normal_read_again = await streams_dao.get_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert normal_read_again is not None
    assert normal_read_again.deleted_at is None


# ---------------------------------------------------------------------------
# MountsDAO.delete_by_session_id — new hard delete of session-bound mounts
# ---------------------------------------------------------------------------


async def test_mounts_delete_by_session_id_hard_deletes_and_returns_rows(
    mounts_dao, project
):
    project_id = project["project_id"]
    user_id = project["user_id"]
    session_id = f"wp5-mounts-{uuid.uuid4().hex[:8]}"

    mount = await mounts_dao.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(
            slug=f"wp5-mount-{uuid.uuid4().hex[:8]}",
            name="cwd",
            session_id=session_id,
        ),
    )

    deleted_mounts = await mounts_dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert len(deleted_mounts) == 1
    assert deleted_mounts[0].id == mount.id

    fetched = await mounts_dao.fetch_mount(project_id=project_id, mount_id=mount.id)
    assert fetched is None


async def test_mounts_delete_by_session_id_scoped_to_session(mounts_dao, project):
    """A mount bound to a different session must survive another session's delete."""
    project_id = project["project_id"]
    user_id = project["user_id"]
    session_a = f"wp5-mounts-a-{uuid.uuid4().hex[:8]}"
    session_b = f"wp5-mounts-b-{uuid.uuid4().hex[:8]}"

    mount_a = await mounts_dao.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(
            slug=f"wp5-mount-a-{uuid.uuid4().hex[:8]}",
            name="cwd",
            session_id=session_a,
        ),
    )
    mount_b = await mounts_dao.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(
            slug=f"wp5-mount-b-{uuid.uuid4().hex[:8]}",
            name="cwd",
            session_id=session_b,
        ),
    )

    deleted_mounts = await mounts_dao.delete_by_session_id(
        project_id=project_id, session_id=session_a
    )
    assert [m.id for m in deleted_mounts] == [mount_a.id]

    still_there = await mounts_dao.fetch_mount(
        project_id=project_id, mount_id=mount_b.id
    )
    assert still_there is not None


async def test_mounts_delete_by_session_id_no_mounts_returns_empty(mounts_dao, project):
    project_id = project["project_id"]
    session_id = f"wp5-mounts-none-{uuid.uuid4().hex[:8]}"

    deleted_mounts = await mounts_dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert deleted_mounts == []
