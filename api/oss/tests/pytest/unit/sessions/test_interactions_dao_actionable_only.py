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

    compiled = str(
        session.captured_stmt.compile(compile_kwargs={"literal_binds": False})
    )
    assert "status" in compiled
    assert "created_at" in compiled
    # bound parameter, not an inline f-string interval literal
    assert "INTERVAL" not in compiled.upper()
