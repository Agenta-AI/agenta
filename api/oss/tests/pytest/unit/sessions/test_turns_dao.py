"""Integration-style tests for SessionTurnsDAO against a real Postgres.

Requires the core_oss migration chain applied and POSTGRES_URI_CORE pointed at that
database. Exercises: append, references GIN `.contains()` filtering, windowed
newest->oldest listing, latest_turn / latest_turn_per_harness resolution, and
hard-delete-by-session — the behaviors a mock cannot faithfully stand in for.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurnCreate,
    SessionTurnQuery,
)
from oss.src.core.shared.dtos import Reference, Windowing
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.turns.dao import SessionTurnsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    """Each pytest-asyncio test gets its own event loop; the module-level engine
    singleton binds its asyncpg pool to the first loop that touches it. Reset it
    so every test starts with a pool bound to its own loop."""
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def project_and_stream():
    """Provision the minimal FK chain: user -> org -> workspace -> project -> stream."""
    engine = get_transactions_engine()

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    stream_id = uuid.uuid4()
    session_id = f"turns-dao-test-{uuid.uuid4().hex[:8]}"

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "turns-dao-test",
                "email": f"turns-dao-test-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": org_id, "name": "turns-dao-test-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "turns-dao-test-ws",
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
                "project_name": "turns-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": org_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": stream_id, "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "stream_id": stream_id,
        "session_id": session_id,
        "user_id": user_id,
    }

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM session_turns WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM session_streams WHERE project_id = :project_id"),
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
def dao():
    return SessionTurnsDAO(engine=get_transactions_engine())


async def test_append_turn_persists_and_sets_created_by_id(dao, project_and_stream):
    """W1.6: append a turn — round-trips every field, and created_by_id is the caller."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"]
    user_id = project_and_stream["user_id"]

    workflow_ref = Reference(id=uuid.uuid4(), slug="my-workflow", version="v1")

    # span_id is a 16-hex OTel span id (runner shape), NOT a UUID; trace_id is a 32-hex
    # OTel trace id that still fits UUID.
    span_id = uuid.uuid4().hex[:16]
    turn = await dao.append(
        project_id=project_id,
        user_id=user_id,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=0,
            harness_kind=HarnessKind.PI,
            agent_session_id="agent-sess-abc",
            sandbox_id="sandbox-1",
            references=[workflow_ref],
            trace_id=uuid.uuid4(),
            span_id=span_id,
            start_time=datetime.now(timezone.utc),
        ),
    )

    assert turn.id is not None
    assert turn.session_id == session_id
    assert turn.stream_id == stream_id
    assert turn.turn_index == 0
    assert turn.harness_kind == HarnessKind.PI
    assert turn.agent_session_id == "agent-sess-abc"
    assert turn.sandbox_id == "sandbox-1"
    assert turn.references == [workflow_ref]
    assert turn.span_id == span_id
    # jp's requirement: append_turn must populate created_by_id from the caller.
    assert turn.created_by_id == user_id

    fetched = await dao.fetch_turn(project_id=project_id, turn_id=turn.id)
    assert fetched is not None
    assert fetched.id == turn.id
    assert fetched.references == [workflow_ref]
    assert fetched.span_id == span_id


async def test_multi_turn_appends_persist_with_incrementing_index_and_stable_stream(
    dao, project_and_stream
):
    """Two turns on one session persist as two rows with incrementing turn_index and the
    same stream_id (the session_streams row id) — the durable-turns invariant a live
    two-turn run relies on. Covers the E2E gap that no test asserted (TEST-GAPS.md §turns)."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"]

    for turn_index in (0, 1):
        await dao.append(
            project_id=project_id,
            user_id=None,
            turn=SessionTurnCreate(
                session_id=session_id,
                stream_id=stream_id,
                turn_index=turn_index,
                harness_kind=HarnessKind.PI,
            ),
        )

    results = await dao.query_turns(
        project_id=project_id,
        query=SessionTurnQuery(session_id=session_id),
    )

    assert len(results) == 2
    assert {t.turn_index for t in results} == {0, 1}
    # Every turn in a session shares the one session_streams row id.
    assert {t.stream_id for t in results} == {stream_id}


async def test_query_turns_filters_by_references_gin_contains(dao, project_and_stream):
    """W1.6: query by references uses the eval_runs GIN `.contains()` pattern."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"] + "-refs"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    target_ref = Reference(id=uuid.uuid4(), slug="target-workflow", version="v1")
    other_ref = Reference(id=uuid.uuid4(), slug="other-workflow", version="v1")

    matching = await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=0,
            harness_kind=HarnessKind.PI,
            references=[target_ref],
        ),
    )
    await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=1,
            harness_kind=HarnessKind.PI,
            references=[other_ref],
        ),
    )

    results = await dao.query_turns(
        project_id=project_id,
        query=SessionTurnQuery(session_id=session_id, references=[target_ref]),
    )

    assert len(results) == 1
    assert results[0].id == matching.id


async def test_query_turns_windowed_newest_to_oldest(dao, project_and_stream):
    """W1.6: windowed list, newest -> oldest."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"] + "-window"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    created_ids = []
    for i in range(3):
        turn = await dao.append(
            project_id=project_id,
            user_id=None,
            turn=SessionTurnCreate(
                session_id=session_id,
                stream_id=stream_id,
                turn_index=i,
                harness_kind=HarnessKind.PI,
            ),
        )
        created_ids.append(turn.id)

    results = await dao.query_turns(
        project_id=project_id,
        query=SessionTurnQuery(session_id=session_id),
        windowing=Windowing(order="descending"),
    )

    assert [r.id for r in results] == list(reversed(created_ids))


async def test_latest_turn_and_latest_turn_per_harness(dao, project_and_stream):
    """W1.6: latest_turn / latest_turn_per_harness — the runner's resume-read (WP3)."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"] + "-latest"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=0,
            harness_kind=HarnessKind.PI,
            agent_session_id="pi-core-sess-0",
            sandbox_id="sandbox-0",
        ),
    )
    await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=1,
            harness_kind=HarnessKind.CLAUDE,
            agent_session_id="claude-sess-1",
            sandbox_id="sandbox-1",
        ),
    )
    latest_pi_core = await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=2,
            harness_kind=HarnessKind.PI,
            agent_session_id="pi-core-sess-2",
            sandbox_id="sandbox-2",
        ),
    )

    # A late-arriving lower-index write for a stale turn must never win — the
    # resume pointer is ORDER BY turn_index DESC, not insertion order.
    latest_overall = await dao.append(
        project_id=project_id,
        user_id=None,
        turn=SessionTurnCreate(
            session_id=session_id,
            stream_id=stream_id,
            turn_index=3,
            harness_kind=HarnessKind.CLAUDE,
            agent_session_id="claude-sess-3",
            sandbox_id="sandbox-3",
        ),
    )

    latest = await dao.latest_turn(project_id=project_id, session_id=session_id)
    assert latest is not None
    assert latest.id == latest_overall.id
    assert latest.turn_index == 3
    assert latest.sandbox_id == "sandbox-3"

    latest_for_pi_core = await dao.latest_turn_per_harness_kind(
        project_id=project_id, session_id=session_id, harness_kind=HarnessKind.PI
    )
    assert latest_for_pi_core is not None
    assert latest_for_pi_core.id == latest_pi_core.id
    assert latest_for_pi_core.agent_session_id == "pi-core-sess-2"


async def test_delete_by_session_id_hard_deletes(dao, project_and_stream):
    """W1.6: hard-delete-by-session (WP5's fan-out)."""
    project_id = project_and_stream["project_id"]
    stream_id = project_and_stream["stream_id"]
    session_id = project_and_stream["session_id"] + "-delete"

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id) "
                "VALUES (:id, :project_id, :session_id)"
            ),
            {"id": uuid.uuid4(), "project_id": project_id, "session_id": session_id},
        )
        await session.commit()

    for i in range(2):
        await dao.append(
            project_id=project_id,
            user_id=None,
            turn=SessionTurnCreate(
                session_id=session_id,
                stream_id=stream_id,
                turn_index=i,
                harness_kind=HarnessKind.PI,
            ),
        )

    deleted_count = await dao.delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert deleted_count == 2

    remaining = await dao.query_turns(
        project_id=project_id, query=SessionTurnQuery(session_id=session_id)
    )
    assert remaining == []
