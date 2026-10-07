"""The records-incomplete flag: a runner reports that a session's record log lost a record,
and every runner reads the fact back on the records query before it rebuilds model context.

The route takes the same credential and permission as record ingest, because the runner that
writes the log is the one that reports on it. The DAO sets the time once and never clears it;
the SQL is pinned here without a database, and `test_records_incomplete_dao.py` runs it
against Postgres.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from sqlalchemy.dialects import postgresql

from oss.src.apis.fastapi.sessions.models import (
    SessionRecordIngestRequest,
    SessionRecordQueryRequest,
    SessionRecordsIncompleteRequest,
    SessionTranscriptWindowing,
)
from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.records.dtos import SessionRecordsPage
from oss.src.core.sessions.records.service import RecordsService
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO


def _authed_request(path: str, project_id, user_id, organization_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    request.state.organization_id = str(organization_id)
    return request


def _ids():
    return uuid4(), uuid4(), uuid4()


# ---------------------------------------------------------------------------
# POST /sessions/records/incomplete
# ---------------------------------------------------------------------------


async def test_incomplete_route_marks_the_session_in_the_callers_project():
    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)
    project_id, user_id, organization_id = _ids()
    request = _authed_request(
        "/sessions/records/incomplete", project_id, user_id, organization_id
    )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        result = await router.mark_records_incomplete(
            request=request,
            body=SessionRecordsIncompleteRequest(session_id="sess-1", turn_id="turn-9"),
        )

    assert result == {"ok": True}
    records_service.mark_records_incomplete.assert_awaited_once_with(
        project_id=project_id,
        session_id="sess-1",
        turn_id="turn-9",
    )


async def test_incomplete_route_checks_the_same_permission_as_record_ingest():
    project_id, user_id, organization_id = _ids()
    seen = []

    async def access(**kwargs):
        seen.append(kwargs["permission"])
        return True

    with (
        patch("oss.src.apis.fastapi.sessions.router.check_action_access", access),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_record",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        router = RecordsRouter(records_service=AsyncMock())
        await router.ingest_record_event(
            request=_authed_request(
                "/sessions/records/ingest", project_id, user_id, organization_id
            ),
            body=SessionRecordIngestRequest(session_id="sess-1"),
        )
        await router.mark_records_incomplete(
            request=_authed_request(
                "/sessions/records/incomplete", project_id, user_id, organization_id
            ),
            body=SessionRecordsIncompleteRequest(session_id="sess-1"),
        )

    assert seen == [Permission.RUN_SESSIONS, Permission.RUN_SESSIONS]


async def test_incomplete_route_refuses_without_permission():
    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)
    project_id, user_id, organization_id = _ids()

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=False,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.mark_records_incomplete(
                request=_authed_request(
                    "/sessions/records/incomplete",
                    project_id,
                    user_id,
                    organization_id,
                ),
                body=SessionRecordsIncompleteRequest(session_id="sess-1"),
            )

    assert exc_info.value.status_code == 403
    records_service.mark_records_incomplete.assert_not_awaited()


async def test_incomplete_route_rejects_a_malformed_session_id():
    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)
    project_id, user_id, organization_id = _ids()

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.mark_records_incomplete(
                request=_authed_request(
                    "/sessions/records/incomplete",
                    project_id,
                    user_id,
                    organization_id,
                ),
                body=SessionRecordsIncompleteRequest(session_id=""),
            )

    assert exc_info.value.status_code == 400
    records_service.mark_records_incomplete.assert_not_awaited()


# ---------------------------------------------------------------------------
# POST /sessions/records/query carries the flag
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("flagged", [True, False])
async def test_records_query_returns_the_flag(flagged):
    records_service = AsyncMock()
    records_service.get_records.return_value = []
    records_service.get_records_incomplete.return_value = flagged
    router = RecordsRouter(records_service=records_service)
    project_id, user_id, organization_id = _ids()

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = await router.query_records(
            _authed_request(
                "/sessions/records/query", project_id, user_id, organization_id
            ),
            query_request=SessionRecordQueryRequest(session_id="sess-1"),
        )

    assert response.records_incomplete is flagged
    assert response.model_dump(exclude_none=True)["records_incomplete"] is flagged
    records_service.get_records_incomplete.assert_awaited_once_with(
        project_id=project_id,
        session_id="sess-1",
    )


async def test_windowed_records_query_returns_the_flag():
    records_service = AsyncMock()
    records_service.get_records_page.return_value = SessionRecordsPage(
        records=[], offset=0, limit=50, next_offset=None, through_sequence=0
    )
    records_service.get_records_incomplete.return_value = True
    router = RecordsRouter(records_service=records_service)
    project_id, user_id, organization_id = _ids()

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = await router.query_records(
            _authed_request(
                "/sessions/records/query", project_id, user_id, organization_id
            ),
            query_request=SessionRecordQueryRequest(
                session_id="sess-1",
                windowing=SessionTranscriptWindowing(
                    offset=0, limit=50, through_sequence=0
                ),
            ),
        )

    assert response.records_incomplete is True


# ---------------------------------------------------------------------------
# Service and DAO
# ---------------------------------------------------------------------------


async def test_service_marks_through_the_dao():
    dao = AsyncMock()
    dao.get_records_incomplete.return_value = True
    service = RecordsService(records_dao=dao)
    project_id = uuid4()

    await service.mark_records_incomplete(
        project_id=project_id, session_id="sess-1", turn_id="turn-1"
    )
    assert await service.get_records_incomplete(
        project_id=project_id, session_id="sess-1"
    )

    dao.mark_records_incomplete.assert_awaited_once_with(
        project_id=project_id, session_id="sess-1"
    )


class _CapturingEngine:
    def __init__(self):
        self.statements = []

    @asynccontextmanager
    async def session(self):
        engine = self

        class _Session:
            async def execute(self, stmt):
                engine.statements.append(stmt)

            async def commit(self):
                pass

        yield _Session()


async def test_dao_sets_the_time_once_and_never_clears_it():
    engine = _CapturingEngine()
    dao = RecordsDAO(engine=engine)

    await dao.mark_records_incomplete(project_id=uuid4(), session_id="sess-1")

    assert len(engine.statements) == 1
    sql = " ".join(
        str(engine.statements[0].compile(dialect=postgresql.dialect())).split()
    )
    # A session with no cursor yet gets one, flagged.
    assert sql.startswith("INSERT INTO session_sequence_cursors")
    assert "records_incomplete_at" in sql.split("ON CONFLICT")[0]
    # An existing cursor is updated only while unflagged, so the first time stands.
    conflict = sql.split("ON CONFLICT")[1]
    assert "DO UPDATE SET records_incomplete_at = now()" in conflict
    assert conflict.rstrip().endswith(
        "WHERE session_sequence_cursors.records_incomplete_at IS NULL"
    )
    # Nothing in the statement ever writes NULL back.
    assert "records_incomplete_at = NULL" not in sql


class _ReadStateEngine:
    """Answers `get_read_state`'s reads in order: cursor, (count, first sequenced), nulls."""

    def __init__(self, *, latest_sequence, record_count, first_sequenced_at=None):
        self.latest_sequence = latest_sequence
        self.counts = (record_count, first_sequenced_at)
        self.scalars = 0

    @asynccontextmanager
    async def session(self):
        engine = self

        class _Result:
            def one(self):
                return engine.counts

        class _Session:
            async def scalar(self, _stmt):
                engine.scalars += 1
                return engine.latest_sequence if engine.scalars == 1 else 0

            async def execute(self, _stmt):
                return _Result()

        yield _Session()


@pytest.mark.parametrize("latest_sequence", [None, 0])
async def test_a_cursor_seeded_by_the_mark_never_makes_history_read_complete(
    latest_sequence,
):
    # Legacy records with no sequence, and either no cursor or the one the mark created.
    dao = RecordsDAO(
        engine=_ReadStateEngine(latest_sequence=latest_sequence, record_count=3)
    )

    state = await dao.get_read_state(project_id=uuid4(), session_id="sess-1")

    assert state.history_complete is False
    assert state.latest_sequence == 0


async def test_sequenced_history_still_reads_complete():
    dao = RecordsDAO(
        engine=_ReadStateEngine(
            latest_sequence=4,
            record_count=4,
            first_sequenced_at=datetime.now(timezone.utc),
        )
    )

    state = await dao.get_read_state(project_id=uuid4(), session_id="sess-1")

    assert state.history_complete is True
