"""Database-backed coverage for `/sessions/query`'s windowing + origin contract.

The existing query/contract unit tests (`test_sessions_query_contract.py` and
friends) only compile SQL — they never execute it against Postgres. That is the
root reason four production defects survived review: `limit=0` returning every
row, `origins:["manual"]` matching zero rows against a real NULL-origin row,
`next` without its companion bound compiling to no WHERE clause, and keyset
paging never being exercised against real rows. This module seeds real
`session_streams` rows and executes the real DAO query (and the request-model
validation in front of it) so those four classes of bug show up as a failing
assertion, not a passing compiled-SQL check.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.apis.fastapi.sessions.models import SessionQueryRequest
from oss.src.apis.fastapi.sessions.utils import normalize_session_query_request
from oss.src.core.sessions.dtos import SessionOrigin
from oss.src.core.sessions.streams.dtos import SessionStreamQuery
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.sessions.streams.dao import (
    MAX_SESSION_QUERY_LIMIT,
    SessionStreamsDAO,
)
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def seeded_project():
    """Provision the FK chain and seed 5 session_streams rows with staggered
    `created_at` timestamps: 3 human (untagged, NULL origin) and 2 trigger-origin
    (tagged `ag.origin=trigger`)."""
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    base = datetime.now(timezone.utc) - timedelta(hours=1)
    manual_ids = [f"sq-manual-{i}-{uuid.uuid4().hex[:8]}" for i in range(3)]
    trigger_ids = [f"sq-trigger-{i}-{uuid.uuid4().hex[:8]}" for i in range(2)]

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "sessions-query-postgres-test",
                "email": f"sessions-query-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": organization_id, "name": "sq-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "sq-ws",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "name": "sq-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )

        # Oldest -> newest: manual[0], manual[1], manual[2], trigger[0], trigger[1].
        for index, session_id in enumerate(manual_ids + trigger_ids):
            is_trigger = session_id in trigger_ids
            created_at = base + timedelta(minutes=index)
            tags = (
                {
                    "ag.origin": "trigger",
                    "ag.trigger.id": str(uuid.uuid4()),
                    "ag.trigger.kind": "schedule",
                    "ag.trigger.delivery_id": str(uuid.uuid4()),
                }
                if is_trigger
                else None
            )
            await session.execute(
                text(
                    "INSERT INTO session_streams "
                    "(id, project_id, created_by_id, session_id, created_at, tags) "
                    "VALUES (:id, :project_id, :user_id, :session_id, :created_at, "
                    "CAST(:tags AS jsonb))"
                ),
                {
                    "id": uuid.uuid4(),
                    "project_id": project_id,
                    "user_id": user_id,
                    "session_id": session_id,
                    "created_at": created_at,
                    # `json.dumps(None) == "null"` — a JSON-null scalar, not a SQL
                    # NULL bind — sidesteps asyncpg's ambiguous-type-for-NULL error
                    # on a bound parameter feeding a `CAST(:x AS jsonb)` expression.
                    # It round-trips to Python `None` on read either way.
                    "tags": json.dumps(tags),
                },
            )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "manual_ids": manual_ids,
        "trigger_ids": trigger_ids,
    }

    async with engine.session() as session:
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
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


async def test_sessions_query_limit_origin_cursor_and_paging_against_real_sql(
    seeded_project,
):
    project_id = seeded_project["project_id"]
    manual_ids = set(seeded_project["manual_ids"])
    trigger_ids = set(seeded_project["trigger_ids"])
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    # -- P0-1: limit bounds -------------------------------------------------- #
    # The request model rejects the pathological values before they ever reach
    # the DAO — this is the primary defense.
    for bad_limit in (0, -1, MAX_SESSION_QUERY_LIMIT + 1):
        with pytest.raises(ValidationError):
            SessionQueryRequest(windowing=Windowing(limit=bad_limit))
    SessionQueryRequest(windowing=Windowing(limit=MAX_SESSION_QUERY_LIMIT))  # no raise

    # Defense-in-depth: an internal caller that builds a `Windowing` directly
    # (bypassing the request model) must still get a bounded, non-empty result —
    # never "no LIMIT clause at all" (the actual P0-1 bug) and never a 500 from a
    # literal `LIMIT -1`.
    zero_limit_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(),
        windowing=Windowing(limit=0),
    )
    assert len(zero_limit_rows) == 1
    negative_limit_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(),
        windowing=Windowing(limit=-5),
    )
    assert len(negative_limit_rows) == 1

    # -- P1-1: origins ["manual"] must match the NULL-origin rows ------------ #
    manual_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(origins=[SessionOrigin.manual]),
        windowing=Windowing(limit=MAX_SESSION_QUERY_LIMIT),
    )
    assert {row.stream.session_id for row in manual_rows} == manual_ids
    assert all(row.stream.origin == SessionOrigin.manual for row in manual_rows)

    trigger_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(origins=[SessionOrigin.trigger]),
        windowing=Windowing(limit=MAX_SESSION_QUERY_LIMIT),
    )
    assert {row.stream.session_id for row in trigger_rows} == trigger_ids

    both_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(
            origins=[SessionOrigin.manual, SessionOrigin.trigger]
        ),
        windowing=Windowing(limit=MAX_SESSION_QUERY_LIMIT),
    )
    assert {row.stream.session_id for row in both_rows} == manual_ids | trigger_ids

    exclude_trigger_rows = await dao.query(
        project_id=project_id,
        filter=SessionStreamQuery(exclude_origins=[SessionOrigin.trigger]),
        windowing=Windowing(limit=MAX_SESSION_QUERY_LIMIT),
    )
    assert {row.stream.session_id for row in exclude_trigger_rows} == manual_ids

    # -- P1-2: `next` without its companion bound must 422, not silently no-op #
    with pytest.raises(HTTPException) as excinfo:
        normalize_session_query_request(
            SessionQueryRequest(windowing=Windowing(next=uuid.uuid4(), limit=5))
        )
    assert excinfo.value.status_code == 422

    with pytest.raises(HTTPException) as excinfo:
        normalize_session_query_request(
            SessionQueryRequest(
                windowing=Windowing(next=uuid.uuid4(), limit=5, order="ascending")
            )
        )
    assert excinfo.value.status_code == 422

    # Providing the companion bound is a normal, valid request.
    normalize_session_query_request(
        SessionQueryRequest(
            windowing=Windowing(
                next=uuid.uuid4(), newest=datetime.now(timezone.utc), limit=5
            )
        )
    )

    # -- P1-3 sanity / paging: three pages, both cursor fields, no gaps or dupes #
    async def _next_page(cursor_stream):
        if cursor_stream is None:
            windowing = Windowing(limit=2, order="descending")
        else:
            windowing = Windowing(
                limit=2,
                order="descending",
                newest=cursor_stream.updated_at or cursor_stream.created_at,
                next=cursor_stream.id,
            )
        return await dao.query(
            project_id=project_id,
            filter=SessionStreamQuery(),
            windowing=windowing,
        )

    page1 = await _next_page(None)
    assert len(page1) == 2
    page2 = await _next_page(page1[-1].stream)
    assert len(page2) == 2
    page3 = await _next_page(page2[-1].stream)
    assert len(page3) == 1

    seen = [row.stream.session_id for row in page1 + page2 + page3]
    assert len(seen) == len(set(seen)), "keyset paging must never repeat a row"
    assert set(seen) == manual_ids | trigger_ids
