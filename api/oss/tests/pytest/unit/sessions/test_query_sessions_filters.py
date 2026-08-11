"""Unit tests for the server-side session-list filters: `flags`, `session_ids`,
`exclude_session_ids`, and `include_total`.

The rule these enforce: a list view's predicates all run server-side. A client that
filters a windowed page filters the window, not the set — wrong counts, wrong empty
states. The DAO already honoured flags and an id set; only the public query hid them.

(a) DAO-level: statement-compilation only (no DB), mirroring
`test_query_sessions_windowing.py`'s dummy-engine monkeypatch pattern.
(b) Service-level: fake streams/turns services, mirroring `test_sessions_root_service.py`,
asserting the filters forward and that `references` + `session_ids` INTERSECT.
"""

from typing import Dict, List, Optional
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import SessionQuery
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQuery,
    SessionStreamQueryFlags,
)
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

    def scalar_one(self):
        return 0


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


def _dao(monkeypatch):
    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)
    return dao_module.SessionStreamsDAO(), session


async def _run_query(monkeypatch, **kwargs):
    dao, session = _dao(monkeypatch)
    await dao.query(project_id=uuid4(), filter=kwargs.pop("filter"), **kwargs)
    return session.captured_stmt


@pytest.mark.asyncio
async def test_flags_compile_to_a_jsonb_containment_check(monkeypatch):
    stmt = await _run_query(
        monkeypatch,
        filter=SessionStreamQuery(flags=SessionStreamQueryFlags(is_alive=True)),
    )

    # A JSONB value has no literal renderer, so compile with binds against the real dialect.
    compiled = stmt.compile(dialect=postgresql.dialect())

    assert "session_streams.flags @>" in str(compiled).replace("\n", " ")
    assert {"is_alive": True} in compiled.params.values()


@pytest.mark.asyncio
async def test_unset_flags_add_no_predicate(monkeypatch):
    # An all-None flags object must not narrow to `flags @> {}` (which matches everything
    # but still costs an index probe) — model_dump(exclude_none) empties it.
    stmt = await _run_query(
        monkeypatch, filter=SessionStreamQuery(flags=SessionStreamQueryFlags())
    )

    sql = str(stmt.compile(dialect=postgresql.dialect()))

    assert "@>" not in sql


@pytest.mark.asyncio
async def test_exclude_session_ids_compiles_to_not_in(monkeypatch):
    stmt = await _run_query(
        monkeypatch, filter=SessionStreamQuery(), exclude_session_ids=["a", "b"]
    )

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "NOT IN" in sql.upper()


@pytest.mark.asyncio
async def test_empty_exclusions_add_no_predicate(monkeypatch):
    # `NOT IN ()` is always true — skipping it keeps the statement (and its plan) clean.
    stmt = await _run_query(
        monkeypatch, filter=SessionStreamQuery(), exclude_session_ids=[]
    )

    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "NOT IN" not in sql.upper()


@pytest.mark.asyncio
async def test_count_shares_the_query_predicate_without_windowing(monkeypatch):
    dao, session = _dao(monkeypatch)

    await dao.count(
        project_id=uuid4(),
        filter=SessionStreamQuery(search="refund", include_ended=True),
        exclude_session_ids=["pinned-1"],
    )
    sql = str(session.captured_stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "count(" in sql.lower()
    assert "lower(session_streams.name) LIKE lower(" in sql
    assert "NOT IN" in sql.upper()
    # A total must not be windowed, or it would just re-report the page size.
    assert "LIMIT" not in sql.upper()


# ---------------------------------------------------------------------------------- #
# (b) Service — forwarding and intersection
# ---------------------------------------------------------------------------------- #


_PROJECT = uuid4()


def _stream(session_id: str) -> SessionStream:
    return SessionStream(id=uuid4(), project_id=_PROJECT, session_id=session_id)


class _FakeStreamsService:
    def __init__(self, streams: Optional[List[SessionStream]] = None):
        self.streams = streams if streams is not None else []
        self.captured: Dict[str, object] = {}
        self.count_captured: Dict[str, object] = {}

    async def query_streams(
        self,
        *,
        project_id,
        filter,
        windowing=None,
        session_ids=None,
        exclude_session_ids=None,
    ):
        self.captured = {
            "filter": filter,
            "session_ids": session_ids,
            "exclude_session_ids": exclude_session_ids,
        }
        return self.streams

    async def count_streams(
        self, *, project_id, filter, session_ids=None, exclude_session_ids=None
    ):
        self.count_captured = {
            "filter": filter,
            "session_ids": session_ids,
            "exclude_session_ids": exclude_session_ids,
        }
        return 42


class _FakeTurn:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.references = None


class _FakeTurnsService:
    def __init__(self, session_ids: List[str]):
        self.session_ids = session_ids

    async def query_turns(self, *, project_id, query):
        return [_FakeTurn(sid) for sid in self.session_ids]

    async def latest_turn_per_session(self, *, project_id, session_ids):
        return {}


def _service(streams_service, turns_service) -> SessionsService:
    return SessionsService(
        streams_service=streams_service,
        turns_service=turns_service,
        interactions_service=None,
        mounts_service=None,
    )


@pytest.mark.asyncio
async def test_flags_and_exclusions_forward_to_the_streams_query():
    streams = _FakeStreamsService([_stream("s1")])
    service = _service(streams, _FakeTurnsService([]))

    await service.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(
            flags=SessionStreamQueryFlags(is_running=True),
            exclude_session_ids=["pinned-1"],
        ),
    )

    assert streams.captured["filter"].flags == SessionStreamQueryFlags(is_running=True)
    assert streams.captured["exclude_session_ids"] == ["pinned-1"]


@pytest.mark.asyncio
async def test_session_ids_restrict_the_query_when_no_references_are_given():
    streams = _FakeStreamsService([_stream("s1")])
    service = _service(streams, _FakeTurnsService([]))

    await service.query_sessions(
        project_id=_PROJECT, query=SessionQuery(session_ids=["s2", "s1"])
    )

    assert streams.captured["session_ids"] == ["s1", "s2"]


@pytest.mark.asyncio
async def test_references_and_session_ids_intersect():
    # Each is a narrowing filter, so only ids satisfying BOTH survive — a pinned session
    # belonging to another agent must not appear under an agent filter.
    streams = _FakeStreamsService([_stream("s2")])
    service = _service(streams, _FakeTurnsService(["s1", "s2"]))

    await service.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(references=[{"id": str(uuid4())}], session_ids=["s2", "s3"]),
    )

    assert streams.captured["session_ids"] == ["s2"]


@pytest.mark.asyncio
async def test_disjoint_reference_and_id_filters_short_circuit_to_empty():
    streams = _FakeStreamsService([_stream("s1")])
    service = _service(streams, _FakeTurnsService(["s1"]))

    result = await service.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(references=[{"id": str(uuid4())}], session_ids=["s9"]),
    )

    assert result == []
    # An empty intersection can match nothing, so the stream query must not run at all.
    assert streams.captured == {}


@pytest.mark.asyncio
async def test_an_explicitly_empty_id_set_matches_nothing():
    streams = _FakeStreamsService([_stream("s1")])
    service = _service(streams, _FakeTurnsService([]))

    result = await service.query_sessions(
        project_id=_PROJECT, query=SessionQuery(session_ids=[])
    )

    assert result == []
    assert streams.captured == {}


@pytest.mark.asyncio
async def test_count_uses_the_same_predicate_as_the_list():
    streams = _FakeStreamsService([_stream("s1")])
    service = _service(streams, _FakeTurnsService([]))
    query = SessionQuery(
        search="refund",
        include_ended=True,
        flags=SessionStreamQueryFlags(is_alive=True),
        exclude_session_ids=["pinned-1"],
    )

    await service.query_sessions(project_id=_PROJECT, query=query)
    total = await service.count_sessions(project_id=_PROJECT, query=query)

    assert total == 42
    assert streams.count_captured["filter"] == streams.captured["filter"]
    assert (
        streams.count_captured["exclude_session_ids"]
        == streams.captured["exclude_session_ids"]
    )


@pytest.mark.asyncio
async def test_count_short_circuits_on_an_empty_intersection():
    streams = _FakeStreamsService([])
    service = _service(streams, _FakeTurnsService(["s1"]))

    total = await service.count_sessions(
        project_id=_PROJECT,
        query=SessionQuery(references=[{"id": str(uuid4())}], session_ids=["s9"]),
    )

    assert total == 0
    assert streams.count_captured == {}
