"""Unit tests for WP0-R3: echo each session's latest-turn `references` on
`/sessions/query` rows.

(a) Service-level: fake streams + fake turns services, mirroring
`test_sessions_root_service.py`'s fake pattern. Asserts each row carries the
HIGHEST `turn_index` turn's `references` (or `None` when the session has no
turns), and that the turns lookup batches — ONE call across every listed
`session_id`, never one `latest_turn` call per row.
(b) DAO-level: statement-compilation only (no DB), mirroring
`test_query_sessions_search.py`'s dummy-engine monkeypatch pattern. Asserts
`latest_turn_per_session` compiles to `DISTINCT ON (session_turns.session_id)`
ordered by `session_id, turn_index DESC`.
"""

from typing import Dict, List, Optional
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import SessionListItem
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurn
from oss.src.core.shared.dtos import Reference


_PROJECT = uuid4()


def _stream(session_id: str) -> SessionStream:
    return SessionStream(id=uuid4(), project_id=_PROJECT, session_id=session_id)


def _turn(
    session_id: str,
    turn_index: int,
    references: Optional[List[Reference]] = None,
) -> SessionTurn:
    return SessionTurn(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        stream_id=uuid4(),
        turn_index=turn_index,
        harness_kind=HarnessKind.PI,
        references=references,
    )


# ---------------------------------------------------------------------------------- #
# (a) Service — batch hydration
# ---------------------------------------------------------------------------------- #


class _FakeStreamsService:
    def __init__(self, rows: List[SessionStream]):
        self.rows = rows

    async def query_streams(
        self,
        *,
        project_id,
        filter,
        windowing=None,
        session_ids=None,
        exclude_session_ids=None,
        read_options=None,
    ):
        if session_ids is not None:
            return [s for s in self.rows if s.session_id in session_ids]
        return list(self.rows)


class _FakeTurnsService:
    """`turns` maps session_id -> every turn for that session (any order); the fake
    computes the highest-turn_index row itself, mirroring the real DAO's
    `DISTINCT ON (session_id) ORDER BY session_id, turn_index DESC` semantics."""

    def __init__(self, turns_by_session: Dict[str, List[SessionTurn]]):
        self.turns_by_session = turns_by_session
        self.latest_turn_per_session_calls: list[dict] = []

    async def query_turns(self, *, project_id, query=None, windowing=None):
        return []

    async def latest_turn_per_session(
        self, *, project_id, session_ids: List[str]
    ) -> Dict[str, SessionTurn]:
        self.latest_turn_per_session_calls.append(
            {"project_id": project_id, "session_ids": list(session_ids)}
        )
        result: Dict[str, SessionTurn] = {}
        for session_id in session_ids:
            turns = self.turns_by_session.get(session_id) or []
            if not turns:
                continue
            result[session_id] = max(turns, key=lambda t: t.turn_index)
        return result


class _FakeInteractionsService:
    pass


class _FakeMountsService:
    pass


def _service(
    *, streams: List[SessionStream], turns_by_session: Dict[str, List[SessionTurn]]
):
    streams_svc = _FakeStreamsService(rows=streams)
    turns_svc = _FakeTurnsService(turns_by_session=turns_by_session)
    svc = SessionsService(
        streams_service=streams_svc,
        turns_service=turns_svc,
        interactions_service=_FakeInteractionsService(),
        mounts_service=_FakeMountsService(),
    )
    return svc, streams_svc, turns_svc


@pytest.mark.asyncio
async def test_query_sessions_echoes_highest_turn_index_references():
    session_with_turns = "session-with-turns"
    session_without_turns = "session-without-turns"

    early_ref = Reference(id=uuid4(), slug="early-workflow", version="v1")
    latest_ref = Reference(id=uuid4(), slug="latest-workflow", version="v2")

    streams = [_stream(session_with_turns), _stream(session_without_turns)]
    turns_by_session = {
        session_with_turns: [
            _turn(session_with_turns, turn_index=0, references=[early_ref]),
            _turn(session_with_turns, turn_index=1, references=[latest_ref]),
        ],
        session_without_turns: [],
    }

    svc, _, turns_svc = _service(streams=streams, turns_by_session=turns_by_session)

    result = await svc.query_sessions(project_id=_PROJECT)

    assert len(result) == 2
    for item in result:
        assert isinstance(item, SessionListItem)

    by_session = {item.session_id: item for item in result}
    assert by_session[session_with_turns].references == [latest_ref]
    assert by_session[session_without_turns].references is None


@pytest.mark.asyncio
async def test_query_sessions_batches_latest_turn_lookup_into_one_call():
    session_a, session_b, session_c = "session-a", "session-b", "session-c"
    streams = [_stream(session_a), _stream(session_b), _stream(session_c)]
    turns_by_session = {
        session_a: [_turn(session_a, turn_index=0)],
        session_b: [_turn(session_b, turn_index=0)],
        session_c: [],
    }

    svc, _, turns_svc = _service(streams=streams, turns_by_session=turns_by_session)

    await svc.query_sessions(project_id=_PROJECT)

    # One batch call covering every listed session_id -- never one lookup per row.
    assert len(turns_svc.latest_turn_per_session_calls) == 1
    assert set(turns_svc.latest_turn_per_session_calls[0]["session_ids"]) == {
        session_a,
        session_b,
        session_c,
    }


@pytest.mark.asyncio
async def test_query_sessions_no_streams_skips_turns_lookup_entirely():
    svc, _, turns_svc = _service(streams=[], turns_by_session={})

    result = await svc.query_sessions(project_id=_PROJECT)

    assert result == []
    assert turns_svc.latest_turn_per_session_calls == []


@pytest.mark.asyncio
async def test_query_sessions_preserves_stream_ordering():
    session_first, session_second = "session-first", "session-second"
    streams = [_stream(session_first), _stream(session_second)]

    svc, _, _ = _service(streams=streams, turns_by_session={})

    result = await svc.query_sessions(project_id=_PROJECT)

    assert [item.session_id for item in result] == [session_first, session_second]


# ---------------------------------------------------------------------------------- #
# (b) DAO — statement compilation for `latest_turn_per_session`
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


@pytest.mark.asyncio
async def test_latest_turn_per_session_compiles_to_distinct_on_session_id(monkeypatch):
    from oss.src.dbs.postgres.sessions.turns import dao as turns_dao_module

    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(
        turns_dao_module, "get_transactions_engine", lambda: mock_engine
    )

    await turns_dao_module.SessionTurnsDAO().latest_turn_per_session(
        project_id=_PROJECT,
        session_ids=["session-a", "session-b"],
    )

    stmt = session.captured_stmt
    sql = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )

    assert "DISTINCT ON (session_turns.session_id)" in sql
    order_by_fragment = sql.split("ORDER BY", 1)[1]
    assert order_by_fragment.strip().startswith(
        "session_turns.session_id, session_turns.turn_index DESC"
    )


@pytest.mark.asyncio
async def test_latest_turn_per_session_empty_session_ids_short_circuits(monkeypatch):
    from oss.src.dbs.postgres.sessions.turns import dao as turns_dao_module

    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(
        turns_dao_module, "get_transactions_engine", lambda: mock_engine
    )

    result = await turns_dao_module.SessionTurnsDAO().latest_turn_per_session(
        project_id=_PROJECT,
        session_ids=[],
    )

    assert result == {}
    # never even touches the engine -- no session_ids means no query
    assert session.captured_stmt is None
