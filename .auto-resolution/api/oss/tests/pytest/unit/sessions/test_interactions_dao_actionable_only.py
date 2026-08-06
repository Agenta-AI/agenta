"""Unit tests for SessionInteractionsDAO.query_interactions actionable_only filter."""

from uuid import uuid4

import pytest

from oss.src.core.sessions.interactions.dtos import SessionInteractionQuery
from oss.src.dbs.postgres.sessions.interactions import dao as dao_module


class _DummyScalars:
    def all(self):
        return []


class _DummyResult:
    def scalars(self):
        return _DummyScalars()


class _DummySession:
    def __init__(self):
        self.captured_stmt = None

    async def execute(self, stmt):
        self.captured_stmt = stmt
        return _DummyResult()


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_actionable_only_filters_pending_and_binds_interval(monkeypatch):
    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)

    await dao_module.SessionInteractionsDAO().query_interactions(
        project_id=uuid4(),
        query=SessionInteractionQuery(actionable_only=True),
    )

    # Assert against the WHERE clause specifically: status/created_at also appear in the SELECT
    # column list, so grepping the full statement can pass even when the filter is missing.
    where = str(
        session.captured_stmt.whereclause.compile(
            compile_kwargs={"literal_binds": False}
        )
    )
    assert "status" in where
    assert "created_at" in where
    assert ">" in where  # created_at compared against the TTL cutoff
    # bound parameter, not an inline f-string interval literal
    assert "INTERVAL" not in where.upper()
