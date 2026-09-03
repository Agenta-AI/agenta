from unittest.mock import AsyncMock
from uuid import uuid4
import zlib

import pytest
from orjson import dumps
from sqlalchemy.dialects import postgresql

from ee.src.core.sessions.records.service import RecordsRetentionService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.dbs.postgres.sessions.streams import dao as streams_dao_module
from oss.src.tasks.asyncio.sessions import records_worker as records_worker_module
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.utils.env import env


def _payload(*, organization_id, project_id, session_id):
    return zlib.compress(
        dumps(
            {
                "organization_id": str(organization_id),
                "project_id": str(project_id),
                "record_event": {
                    "project_id": str(project_id),
                    "session_id": session_id,
                    "record_index": 0,
                },
            }
        )
    )


def _worker(*, records_dao, streams_dao=None):
    return RecordsWorker(
        service=RecordsService(records_dao=records_dao, streams_dao=streams_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
    )


@pytest.mark.asyncio
async def test_records_worker_never_checks_tracing_quota(monkeypatch):
    entitlement_check = AsyncMock(return_value=(False, None, None))
    monkeypatch.setattr(
        records_worker_module,
        "check_entitlements",
        entitlement_check,
        raising=False,
    )
    project_id = uuid4()
    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(return_value=[object()])

    appended, processed = await _worker(records_dao=records_dao).process_batch(
        [
            (
                b"1-0",
                {
                    b"data": _payload(
                        organization_id=uuid4(),
                        project_id=project_id,
                        session_id="sess-quota-exempt",
                    )
                },
            )
        ]
    )

    assert appended == 1
    assert processed == [b"1-0"]
    entitlement_check.assert_not_awaited()
    records_dao.append_many.assert_awaited_once()


@pytest.mark.asyncio
async def test_dropped_append_marks_every_affected_history_incomplete():
    project_id = uuid4()
    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(
        side_effect=RuntimeError("database unavailable")
    )
    streams_dao = AsyncMock()
    streams_dao.mark_history_incomplete = AsyncMock(return_value=2)

    appended, processed = await _worker(
        records_dao=records_dao,
        streams_dao=streams_dao,
    ).process_batch(
        [
            (
                b"1-0",
                {
                    b"data": _payload(
                        organization_id=uuid4(),
                        project_id=project_id,
                        session_id="sess-a",
                    )
                },
            ),
            (
                b"2-0",
                {
                    b"data": _payload(
                        organization_id=uuid4(),
                        project_id=project_id,
                        session_id="sess-b",
                    )
                },
            ),
        ]
    )

    assert appended == 0
    assert processed == [b"1-0", b"2-0"]
    streams_dao.mark_history_incomplete.assert_awaited_once_with(
        project_id=project_id,
        session_ids=["sess-a", "sess-b"],
    )


class _Result:
    rowcount = 2


class _Session:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result()

    async def commit(self):
        return None


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_incomplete_marker_is_a_monotonic_bulk_update(monkeypatch):
    session = _Session()
    engine = type("Engine", (), {"session": lambda self: _SessionContext(session)})()
    monkeypatch.setattr(
        streams_dao_module,
        "get_transactions_engine",
        lambda: engine,
    )

    marked = await streams_dao_module.SessionStreamsDAO().mark_history_incomplete(
        project_id=uuid4(),
        session_ids=["sess-a", "sess-b"],
    )

    sql = str(session.statement.compile(dialect=postgresql.dialect())).lower()
    assert marked == 2
    assert "update session_streams" in sql
    assert "history_incomplete" in sql
    assert "history_incomplete is not true" in sql


@pytest.mark.asyncio
async def test_records_retention_defaults_to_keep(monkeypatch):
    monkeypatch.setattr(env.sessions, "history_retention_days", None)
    dao = AsyncMock()

    await RecordsRetentionService(records_retention_dao=dao).flush_records()

    dao.fetch_projects.assert_not_awaited()
    dao.delete_records_before_cutoff.assert_not_awaited()


@pytest.mark.asyncio
async def test_records_retention_uses_only_session_setting(monkeypatch):
    monkeypatch.setattr(env.sessions, "history_retention_days", 7)
    project_id = uuid4()
    dao = AsyncMock()
    dao.fetch_projects = AsyncMock(side_effect=[[project_id], []])
    dao.delete_records_before_cutoff = AsyncMock(return_value=3)

    await RecordsRetentionService(records_retention_dao=dao).flush_records(
        max_projects_per_batch=10,
        max_records_per_batch=20,
    )

    assert dao.fetch_projects.await_count == 2
    dao.delete_records_before_cutoff.assert_awaited_once()
    call = dao.delete_records_before_cutoff.await_args.kwargs
    assert call["project_ids"] == [project_id]
    assert call["max_records"] == 20
