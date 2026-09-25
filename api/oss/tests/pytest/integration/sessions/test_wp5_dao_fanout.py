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
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from oss.src.apis.fastapi.sessions.utils import compute_session_response_windowing
from oss.src.core.sessions.dtos import SessionOrigin
from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionCreate,
    SessionInteractionData,
    SessionInteractionKind,
    SessionInteractionQuery,
    SessionInteractionRequest,
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.streams.dtos import (
    SessionStreamQuery,
    SessionStreamReadOptions,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.shared.dtos import Windowing
from oss.src.core.mounts.dtos import MountCreate, MountQuery
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
# SessionInteractionsDAO transition resolution
# ---------------------------------------------------------------------------


async def test_interaction_transition_preserves_data_and_optionally_adds_resolution(
    interactions_dao, project
):
    project_id = project["project_id"]
    session_id = f"interaction-resolution-{uuid.uuid4().hex[:8]}"
    request = {"tool": "bash", "args": {"command": "ls"}}

    await interactions_dao.create_interaction(
        project_id=project_id,
        user_id=None,
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id=session_id,
            token="approval-token",
            kind=SessionInteractionKind.user_approval,
            data=SessionInteractionData(request=request),
        ),
    )
    transitioned = await interactions_dao.transition_interaction(
        transition=SessionInteractionTransition(
            project_id=project_id,
            session_id=session_id,
            token="approval-token",
            status=SessionInteractionStatus.resolved,
            resolution={"verdict": "approved", "tool_call_id": "tool-1"},
        )
    )

    assert transitioned is not None
    assert transitioned.status == SessionInteractionStatus.resolved
    assert transitioned.data is not None
    assert transitioned.data.request == SessionInteractionRequest(**request)
    assert transitioned.data.resolution == {
        "verdict": "approved",
        "tool_call_id": "tool-1",
    }

    await interactions_dao.create_interaction(
        project_id=project_id,
        user_id=None,
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id=session_id,
            token="client-token",
            kind=SessionInteractionKind.client_tool,
            data=SessionInteractionData(request=request),
        ),
    )
    transitioned_without_resolution = await interactions_dao.transition_interaction(
        transition=SessionInteractionTransition(
            project_id=project_id,
            session_id=session_id,
            token="client-token",
            status=SessionInteractionStatus.resolved,
        )
    )

    assert transitioned_without_resolution is not None
    assert transitioned_without_resolution.data is not None
    assert transitioned_without_resolution.data.request == SessionInteractionRequest(
        **request
    )
    assert transitioned_without_resolution.data.resolution is None


async def test_cancel_pending_returns_exactly_the_rows_it_transitioned(
    interactions_dao, project
):
    project_id = project["project_id"]
    session_id = f"interaction-cancel-returning-{uuid.uuid4().hex[:8]}"

    for token in ("pending-1", "pending-2", "already-answered"):
        await interactions_dao.create_interaction(
            project_id=project_id,
            user_id=None,
            interaction=SessionInteractionCreate(
                project_id=project_id,
                session_id=session_id,
                turn_id="turn-1",
                token=token,
                kind=SessionInteractionKind.user_approval,
            ),
        )

    await interactions_dao.transition_interaction(
        transition=SessionInteractionTransition(
            project_id=project_id,
            session_id=session_id,
            token="already-answered",
            status=SessionInteractionStatus.responded,
        )
    )

    cancelled = await interactions_dao.cancel_session_pending(
        project_id=project_id,
        session_id=session_id,
        only_turn_id="turn-1",
    )

    assert {interaction.token for interaction in cancelled} == {
        "pending-1",
        "pending-2",
    }
    assert all(
        interaction.status == SessionInteractionStatus.cancelled
        for interaction in cancelled
    )
    assert (
        await interactions_dao.cancel_session_pending(
            project_id=project_id,
            session_id=session_id,
            only_turn_id="turn-1",
        )
        == []
    )


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


# ---------------------------------------------------------------------------
# MountsDAO.query_mounts — default ordering when no windowing is passed
# ---------------------------------------------------------------------------


async def test_query_mounts_without_windowing_orders_oldest_first(mounts_dao, project):
    """Consumers index into the returned list (the web drive picks a mount out of it),
    so the unwindowed query must be deterministic: oldest created_at first."""
    project_id = project["project_id"]
    user_id = project["user_id"]
    session_id = f"wp5-mounts-order-{uuid.uuid4().hex[:8]}"

    mounts = []
    for label in ("cwd", "pi-sessions", "notes"):
        mounts.append(
            await mounts_dao.create_mount(
                project_id=project_id,
                user_id=user_id,
                mount_create=MountCreate(
                    slug=f"wp5-order-{label}-{uuid.uuid4().hex[:8]}",
                    name=label,
                    session_id=session_id,
                ),
            )
        )

    # Stamp created_at out of insertion order so the assertion pins the ORDER BY, not the
    # order the rows were written in.
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    stamps = [base + timedelta(minutes=offset) for offset in (2, 0, 1)]
    async with get_transactions_engine().session() as session:
        for mount, created_at in zip(mounts, stamps):
            await session.execute(
                text(
                    "UPDATE mounts SET created_at = :created_at "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {
                    "created_at": created_at,
                    "project_id": project_id,
                    "id": mount.id,
                },
            )
        await session.commit()

    queried = await mounts_dao.query_mounts(
        project_id=project_id,
        mount_query=MountQuery(session_id=session_id),
    )

    assert [m.id for m in queried] == [mounts[1].id, mounts[2].id, mounts[0].id]


async def test_stream_origin_filters_preserve_null_and_unstamped_rows(
    streams_dao, project
):
    project_id = project["project_id"]
    rows = [
        (uuid.uuid4(), "trigger", '{"ag.origin": "trigger"}'),
        (uuid.uuid4(), "unstamped", '{"team": "support"}'),
        (uuid.uuid4(), "null-tags", None),
    ]
    async with get_transactions_engine().session() as session:
        for row_id, suffix, tags in rows:
            await session.execute(
                text(
                    "INSERT INTO session_streams "
                    "(id, project_id, session_id, flags, tags) VALUES "
                    "(:id, :project_id, :session_id, CAST(:flags AS jsonb), "
                    "CAST(:tags AS jsonb))"
                ),
                {
                    "id": row_id,
                    "project_id": project_id,
                    "session_id": f"origin-{suffix}-{uuid.uuid4().hex[:8]}",
                    "flags": "{}",
                    "tags": tags,
                },
            )
        await session.commit()

    included = await streams_dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(origins=[SessionOrigin.trigger]),
    )
    excluded = await streams_dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(exclude_origins=[SessionOrigin.trigger]),
    )

    assert [result.stream.id for result in included] == [rows[0][0]]
    assert {result.stream.id for result in excluded} == {rows[1][0], rows[2][0]}


@pytest.mark.parametrize("order", ["ascending", "descending"])
async def test_stream_tied_activity_cursor_pages_without_duplicates(
    streams_dao, project, order
):
    project_id = project["project_id"]
    activity = datetime(2026, 8, 10, tzinfo=timezone.utc)
    row_ids = sorted(uuid.uuid4() for _ in range(5))
    async with get_transactions_engine().session() as session:
        for index, row_id in enumerate(row_ids):
            await session.execute(
                text(
                    "INSERT INTO session_streams "
                    "(id, project_id, session_id, created_at, updated_at, flags) VALUES "
                    "(:id, :project_id, :session_id, :activity, :activity, "
                    "CAST(:flags AS jsonb))"
                ),
                {
                    "id": row_id,
                    "project_id": project_id,
                    "session_id": f"cursor-{order}-{index}-{uuid.uuid4().hex[:8]}",
                    "activity": activity,
                    "flags": "{}",
                },
            )
        await session.commit()

    first_page = await streams_dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(),
        windowing=Windowing(limit=2, order=order),
    )
    first_page_streams = [result.stream for result in first_page]
    cursor = compute_session_response_windowing(
        sessions=first_page_streams,
        requested=Windowing(limit=2, order=order),
    )
    second_page = await streams_dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(),
        windowing=cursor,
    )

    expected = sorted(row_ids, reverse=order == "descending")
    second_page_streams = [result.stream for result in second_page]
    assert [
        stream.id for stream in first_page_streams + second_page_streams
    ] == expected[:4]
    assert {stream.id for stream in first_page_streams}.isdisjoint(
        stream.id for stream in second_page_streams
    )


async def test_trigger_expansion_isolates_project_and_kind_for_live_and_deleted_names(
    streams_dao, project
):
    engine = get_transactions_engine()
    project_id = project["project_id"]
    user_id = project["user_id"]
    configuration_id = uuid.uuid4()
    schedule_stream_id = uuid.uuid4()
    subscription_stream_id = uuid.uuid4()
    other_project_id = uuid.uuid4()
    schedule_tags = (
        '{"ag.origin":"trigger","ag.trigger.id":"'
        f'{configuration_id}","ag.trigger.kind":"schedule"}}'
    )
    subscription_tags = (
        '{"ag.origin":"trigger","ag.trigger.id":"'
        f'{configuration_id}","ag.trigger.kind":"subscription"}}'
    )
    async with engine.session() as session:
        scope = (
            (
                await session.execute(
                    text(
                        "SELECT workspace_id, organization_id FROM projects WHERE id = :id"
                    ),
                    {"id": project_id},
                )
            )
            .mappings()
            .one()
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": other_project_id,
                "name": "trigger-join-isolation-project",
                "workspace_id": scope["workspace_id"],
                "organization_id": scope["organization_id"],
            },
        )
        for scoped_project_id, suffix in (
            (project_id, "target"),
            (other_project_id, "other"),
        ):
            await session.execute(
                text(
                    "INSERT INTO gateway_connections "
                    "(id, project_id, created_by_id, slug, provider_key, integration_key) "
                    "VALUES (:id, :project_id, :user_id, :slug, :provider, :integration)"
                ),
                {
                    "id": uuid.uuid4(),
                    "project_id": scoped_project_id,
                    "user_id": user_id,
                    "slug": f"trigger-join-{suffix}",
                    "provider": "composio",
                    "integration": "github",
                },
            )
        connections = (
            await session.execute(
                text(
                    "SELECT project_id, id FROM gateway_connections "
                    "WHERE project_id IN (:project_id, :other_project_id) "
                    "AND slug IN ('trigger-join-target', 'trigger-join-other')"
                ),
                {
                    "project_id": project_id,
                    "other_project_id": other_project_id,
                },
            )
        ).all()
        connection_by_project = {row.project_id: row.id for row in connections}

        for scoped_project_id, schedule_name, subscription_name in (
            (project_id, "Target schedule", "Target subscription"),
            (other_project_id, "Other schedule", "Other subscription"),
        ):
            await session.execute(
                text(
                    "INSERT INTO trigger_schedules (id, project_id, name) "
                    "VALUES (:id, :project_id, :name)"
                ),
                {
                    "id": configuration_id,
                    "project_id": scoped_project_id,
                    "name": schedule_name,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO trigger_subscriptions "
                    "(id, project_id, connection_id, name) "
                    "VALUES (:id, :project_id, :connection_id, :name)"
                ),
                {
                    "id": configuration_id,
                    "project_id": scoped_project_id,
                    "connection_id": connection_by_project[scoped_project_id],
                    "name": subscription_name,
                },
            )

        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id, tags) VALUES "
                "(:schedule_stream_id, :project_id, :schedule_session_id, "
                "CAST(:schedule_tags AS jsonb)), "
                "(:subscription_stream_id, :project_id, :subscription_session_id, "
                "CAST(:subscription_tags AS jsonb))"
            ),
            {
                "schedule_stream_id": schedule_stream_id,
                "subscription_stream_id": subscription_stream_id,
                "project_id": project_id,
                "schedule_session_id": "trigger-join-schedule",
                "subscription_session_id": "trigger-join-subscription",
                "schedule_tags": schedule_tags,
                "subscription_tags": subscription_tags,
            },
        )
        await session.commit()

    options = SessionStreamReadOptions(include_trigger_details=True)
    service = SessionStreamsService(streams_dao=streams_dao, lock_engine=object())
    try:
        unexpanded = await service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(),
        )
        assert len(unexpanded) == 2
        assert all(row.trigger.name is None for row in unexpanded)

        live = await service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(),
            read_options=options,
        )
        assert len(live) == 2
        live_by_id = {row.id: row for row in live}
        assert set(live_by_id) == {schedule_stream_id, subscription_stream_id}
        assert live_by_id[schedule_stream_id].trigger.name == "Target schedule"
        assert live_by_id[subscription_stream_id].trigger.name == "Target subscription"

        async with engine.session() as session:
            await session.execute(
                text(
                    "UPDATE trigger_schedules "
                    "SET name = :name, deleted_at = now() "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {
                    "name": "Deleted schedule",
                    "project_id": project_id,
                    "id": configuration_id,
                },
            )
            await session.execute(
                text(
                    "UPDATE trigger_subscriptions "
                    "SET name = :name, deleted_at = now() "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {
                    "name": "Deleted subscription",
                    "project_id": project_id,
                    "id": configuration_id,
                },
            )
            await session.commit()

        historical = await service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(),
            read_options=options,
        )
        assert len(historical) == 2
        historical_by_id = {row.id: row for row in historical}
        assert set(historical_by_id) == {schedule_stream_id, subscription_stream_id}
        assert historical_by_id[schedule_stream_id].trigger.name == "Deleted schedule"
        assert (
            historical_by_id[subscription_stream_id].trigger.name
            == "Deleted subscription"
        )
        assert all(
            row.trigger.id == configuration_id for row in historical_by_id.values()
        )
    finally:
        async with engine.session() as session:
            await session.execute(
                text("DELETE FROM projects WHERE id = :id"),
                {"id": other_project_id},
            )
            await session.commit()


async def test_trigger_expansion_guards_malformed_uuid_and_keeps_delivery(
    streams_dao, project
):
    project_id = project["project_id"]
    stream_id = uuid.uuid4()
    delivery_id = uuid.uuid4()
    tags = (
        '{"ag.origin":"trigger","ag.trigger.id":"not-a-uuid",'
        '"ag.trigger.kind":"schedule","ag.trigger.delivery_id":"'
        f'{delivery_id}"}}'
    )
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id, tags) "
                "VALUES (:id, :project_id, :session_id, CAST(:tags AS jsonb))"
            ),
            {
                "id": stream_id,
                "project_id": project_id,
                "session_id": f"malformed-trigger-{uuid.uuid4().hex[:8]}",
                "tags": tags,
            },
        )
        await session.commit()

    service = SessionStreamsService(streams_dao=streams_dao, lock_engine=object())
    rows = await service.query_streams(
        project_id=project_id,
        filter=SessionStreamQuery(),
        read_options=SessionStreamReadOptions(include_trigger_details=True),
    )

    result = next(row for row in rows if row.id == stream_id)
    assert result.trigger is None
    assert result.delivery.id == delivery_id


async def test_missing_trigger_configuration_keeps_typed_identity(streams_dao, project):
    project_id = project["project_id"]
    stream_id = uuid.uuid4()
    trigger_id = uuid.uuid4()
    tags = (
        '{"ag.origin":"trigger","ag.trigger.id":"'
        f'{trigger_id}","ag.trigger.kind":"subscription"}}'
    )
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id, tags) "
                "VALUES (:id, :project_id, :session_id, CAST(:tags AS jsonb))"
            ),
            {
                "id": stream_id,
                "project_id": project_id,
                "session_id": f"missing-trigger-{uuid.uuid4().hex[:8]}",
                "tags": tags,
            },
        )
        await session.commit()

    service = SessionStreamsService(streams_dao=streams_dao, lock_engine=object())
    rows = await service.query_streams(
        project_id=project_id,
        filter=SessionStreamQuery(),
        read_options=SessionStreamReadOptions(include_trigger_details=True),
    )

    result = next(row for row in rows if row.id == stream_id)
    assert result.trigger.name is None
    assert result.trigger.id == trigger_id
    assert result.trigger.kind.value == "subscription"
