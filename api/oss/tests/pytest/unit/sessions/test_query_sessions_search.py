"""Unit tests for WP0-R2: free-text title search on `/sessions/query`.

`search` is a case-insensitive substring filter over `session_streams.name` (the
session title, HeaderDBA). Known coverage caveat (accepted): auto-titling is FE-only
today, so untitled sessions won't match.

(a) DAO-level: statement-compilation only (no DB), mirroring
`test_query_sessions_windowing.py`'s dummy-engine monkeypatch pattern.
(b) Service-level: fake streams service, mirroring `test_sessions_root_service.py`'s
fake pattern, asserting `search` forwards from the core `SessionQuery` into the
`SessionStreamQuery` built for `streams_service.query_streams`.
"""

from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.sessions.dtos import SessionQuery
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamQuery
from oss.src.dbs.postgres.sessions.streams import dao as dao_module


# ---------------------------------------------------------------------------------- #
# (a) DAO — statement compilation
# ---------------------------------------------------------------------------------- #


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


async def _run_query(monkeypatch, *, search: Optional[str]):
    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)

    await dao_module.SessionStreamsDAO().query(
        project_id=uuid4(),
        filter=SessionStreamQuery(search=search),
    )
    return session.captured_stmt


@pytest.mark.asyncio
async def test_search_compiles_to_case_insensitive_like_on_name(monkeypatch):
    stmt = await _run_query(monkeypatch, search="Refund")

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    params = stmt.compile().params

    # Generic-dialect ilike renders as lower(...) LIKE lower(...); assert the actual
    # rendering rather than assuming ILIKE (that's postgres-dialect-specific).
    assert "lower(session_streams.name) LIKE lower(" in sql
    assert params["name_1"] == "%Refund%"


@pytest.mark.asyncio
async def test_search_escapes_like_special_characters(monkeypatch):
    stmt = await _run_query(monkeypatch, search="50%_done\\x")

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    params = stmt.compile().params

    assert params["name_1"] == "%50\\%\\_done\\\\x%"
    assert "ESCAPE '\\'" in sql


@pytest.mark.asyncio
async def test_absent_search_has_no_like_clause(monkeypatch):
    stmt = await _run_query(monkeypatch, search=None)

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "LIKE" not in sql.upper()


@pytest.mark.asyncio
async def test_blank_search_has_no_like_clause(monkeypatch):
    stmt = await _run_query(monkeypatch, search="")

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "LIKE" not in sql.upper()


@pytest.mark.asyncio
async def test_whitespace_only_search_has_no_like_clause(monkeypatch):
    stmt = await _run_query(monkeypatch, search="   ")

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "LIKE" not in sql.upper()


# ---------------------------------------------------------------------------------- #
# (b) Service — forwarding into the streams query
# ---------------------------------------------------------------------------------- #


_PROJECT = uuid4()
_SESSION = "session-wp0-r2"


def _stream(session_id: str = _SESSION) -> SessionStream:
    return SessionStream(id=uuid4(), project_id=_PROJECT, session_id=session_id)


class _FakeStreamsService:
    """Mirrors `test_sessions_root_service.py`'s `_FakeStreamsService`, plus capturing
    the `filter` kwarg (unused by the existing fake) so `search` forwarding is
    observable."""

    def __init__(self, row: Optional[SessionStream] = None):
        self.row = row
        self.query_calls: list[dict] = []

    async def query_streams(
        self, *, project_id, filter, windowing=None, session_ids=None
    ):
        self.query_calls.append({"project_id": project_id, "filter": filter})
        return [self.row] if self.row else []


class _FakeTurnsService:
    async def query_turns(self, *, project_id, query=None, windowing=None):
        return []


class _FakeInteractionsService:
    pass


class _FakeMountsService:
    pass


@pytest.mark.asyncio
async def test_service_forwards_search_into_stream_query():
    streams = _FakeStreamsService(row=_stream())
    svc = SessionsService(
        streams_service=streams,
        turns_service=_FakeTurnsService(),
        interactions_service=_FakeInteractionsService(),
        mounts_service=_FakeMountsService(),
    )

    await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(search="x"),
    )

    assert streams.query_calls[0]["filter"].search == "x"
