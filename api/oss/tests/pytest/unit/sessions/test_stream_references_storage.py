"""`session_streams.references`: the SQL that fills it, the mapping that stores it, and
the list that prefers it.

The column exists because references rode only on `session_turns`, appended
fire-and-forget after a run started. A dropped append left the row with nothing to open
the session with — 98.2% of untitled sessions had no references at all. The row now
carries its own copy.

Complements `test_stream_fill_once.py`, which pins the service-level rule; this file pins
the three places the rule has to survive: the statement, the JSONB round trip, and the
read.
"""

from typing import Dict, List, Optional
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import SessionQuery, SessionQueryLifecycle
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamQuery,
)
from oss.src.core.sessions.turns.dtos import SessionTurn
from oss.src.core.sessions.types import ReferenceKey, SessionReference
from oss.src.dbs.postgres.sessions.streams import dao as dao_module
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
)

from agenta.sdk.agents.dtos import HarnessKind


_PROJECT = uuid4()


def _references() -> List[SessionReference]:
    return [
        SessionReference(id=uuid4(), slug="chat", key=ReferenceKey.workflow),
        SessionReference(id=uuid4(), slug="chat", key=ReferenceKey.workflow_variant),
        SessionReference(
            id=uuid4(), slug="chat", version="3", key=ReferenceKey.workflow_revision
        ),
    ]


# ---------------------------------------------------------------------------------- #
# The statement: fill-once is enforced in SQL, not by a read-then-write.
# ---------------------------------------------------------------------------------- #


class _DummyResult:
    rowcount = 1


class _DummySession:
    def __init__(self):
        self.captured_stmt = None

    async def execute(self, stmt):
        self.captured_stmt = stmt
        return _DummyResult()

    async def commit(self):
        return None


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


def _compiled(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


@pytest.mark.asyncio
async def test_the_fill_statement_coalesces_behind_a_null_guard(monkeypatch):
    """One UPDATE, not a read-then-write.

    A read-then-write would let a rename land in the gap and be silently overwritten by
    a heartbeat's proposal — the one thing fill-once must never do.
    """
    dao, session = _dao(monkeypatch)

    await dao.fill_missing(
        project_id=_PROJECT,
        session_id="s-1",
        name="A title",
        references=_references(),
    )

    sql = _compiled(session.captured_stmt).lower()
    assert "update session_streams" in sql
    assert "coalesce(session_streams.name" in sql
    assert 'coalesce(session_streams."references"' in sql
    assert "session_streams.name is null" in sql
    assert 'session_streams."references" is null' in sql
    # A killed row must not be resurrected by a late beat from its own last turn.
    assert "session_streams.deleted_at is null" in sql


@pytest.mark.asyncio
async def test_filling_only_one_column_guards_only_that_column(monkeypatch):
    dao, session = _dao(monkeypatch)

    await dao.fill_missing(project_id=_PROJECT, session_id="s-1", name="A title")

    sql = _compiled(session.captured_stmt).lower()
    assert "coalesce(session_streams.name" in sql
    assert "references" not in sql, (
        "guarding on a column this call does not write would skip rows that need the name"
    )


@pytest.mark.asyncio
async def test_a_fill_with_nothing_to_fill_issues_no_statement(monkeypatch):
    dao, session = _dao(monkeypatch)

    filled = await dao.fill_missing(project_id=_PROJECT, session_id="s-1")

    assert filled is False
    assert session.captured_stmt is None


@pytest.mark.asyncio
async def test_an_empty_proposal_is_not_a_proposal(monkeypatch):
    """`""` and `[]` are "nothing to say", not "store empty". Each column is fillable
    once, so writing either would spend that chance and refuse the real value later."""
    dao, session = _dao(monkeypatch)

    filled = await dao.fill_missing(
        project_id=_PROJECT, session_id="s-1", name="", references=[]
    )

    assert filled is False
    assert session.captured_stmt is None


# ---------------------------------------------------------------------------------- #
# The round trip: `key` survives storage.
# ---------------------------------------------------------------------------------- #


def test_references_round_trip_through_the_row_with_their_keys():
    references = _references()

    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(session_id="s-1", references=references),
    )
    restored = map_stream_dbe_to_dto(stream_dbe=dbe)

    assert [element["key"] for element in dbe.references] == [
        "workflow",
        "workflow_variant",
        "workflow_revision",
    ]
    assert restored.references == references


def test_an_untagged_legacy_element_still_reads_back():
    # Rows written before elements carried a family must keep loading, untagged.
    dbe = SessionStreamDBE(
        id=uuid4(),
        project_id=_PROJECT,
        session_id="s-1",
        references=[{"id": str(uuid4()), "slug": "legacy"}],
    )

    restored = map_stream_dbe_to_dto(stream_dbe=dbe)

    assert restored.references[0].key is None
    assert restored.references[0].slug == "legacy"


def test_the_turn_append_accepts_and_stores_the_family_key():
    """The runner stamps `key` on BOTH serializations, so the turn ledger has to keep it
    too — not just the heartbeat. A partial family is the normal case: a variant-only run
    emits exactly one element."""
    from oss.src.apis.fastapi.sessions.models import SessionTurnAppendRequest
    from oss.src.core.sessions.turns.dtos import SessionTurnCreate
    from oss.src.dbs.postgres.sessions.turns.mappings import (
        map_turn_dbe_to_dto,
        map_turn_dto_to_dbe_create,
    )

    variant_id = uuid4()
    request = SessionTurnAppendRequest.model_validate(
        {
            "session_id": "s-1",
            "stream_id": str(uuid4()),
            "turn_index": 0,
            "harness_kind": "claude",
            "references": [
                {"id": str(variant_id), "slug": "wf", "key": "workflow_variant"}
            ],
        }
    )

    dbe = map_turn_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        turn=SessionTurnCreate(
            session_id="s-1",
            stream_id=request.stream_id,
            turn_index=0,
            harness_kind=request.harness_kind,
            references=request.references,
        ),
    )

    assert dbe.references == [
        {"slug": "wf", "id": str(variant_id), "key": "workflow_variant"}
    ]
    assert map_turn_dbe_to_dto(turn_dbe=dbe).references[0].key == "workflow_variant"


def test_an_unrecognized_key_is_stored_rather_than_rejected():
    """A turn append is fire-and-forget: rejecting an unknown family would drop the whole
    turn, which is the failure the field exists to prevent."""
    reference = SessionReference.model_validate(
        {"id": str(uuid4()), "key": "application_revision"}
    )

    assert reference.key == "application_revision"


# ---------------------------------------------------------------------------------- #
# The read: the row's references win; the turn's are the fallback.
# ---------------------------------------------------------------------------------- #


class _FakeStreamsService:
    def __init__(
        self,
        streams: List[SessionStream],
        reference_session_ids: Optional[List[str]] = None,
    ):
        self._streams = streams
        self.captured_session_ids: Optional[List[str]] = None
        self.reference_session_ids = reference_session_ids or []

    async def query_streams(self, **kwargs):
        self.captured_session_ids = kwargs.get("session_ids")
        return self._streams

    async def count_streams(self, **kwargs):
        return len(self._streams)

    async def query_session_ids_by_references(self, *, project_id, references, limit):
        return self.reference_session_ids[:limit]


class _FakeTurnsService:
    def __init__(
        self,
        turns: Dict[str, SessionTurn],
        reference_session_ids: Optional[List[str]] = None,
    ):
        self._turns = turns
        self.reference_session_ids = reference_session_ids or []

    async def latest_turn_per_session(self, *, project_id, session_ids):
        return {k: v for k, v in self._turns.items() if k in session_ids}

    async def query_session_ids_by_references(self, *, project_id, references, limit):
        return self.reference_session_ids[:limit]


def _stream(session_id: str, references: Optional[List[SessionReference]] = None):
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        references=references,
    )


def _turn(session_id: str, references: List[SessionReference]) -> SessionTurn:
    return SessionTurn(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        stream_id=uuid4(),
        turn_index=0,
        harness_kind=HarnessKind.CLAUDE,
        references=references,
    )


def _sessions_service(
    streams,
    turns,
    *,
    ids_by_turn_references=None,
    ids_by_stream_references=None,
):
    streams_service = _FakeStreamsService(streams, ids_by_stream_references)
    return (
        SessionsService(
            streams_service=streams_service,
            turns_service=_FakeTurnsService(turns, ids_by_turn_references),
            interactions_service=None,
            mounts_service=None,
        ),
        streams_service,
    )


@pytest.mark.asyncio
async def test_the_list_prefers_the_row_over_the_turn():
    row_references = _references()
    turn_references = [SessionReference(id=uuid4(), key=ReferenceKey.workflow)]
    svc, _ = _sessions_service(
        [_stream("s-1", row_references)],
        {"s-1": _turn("s-1", turn_references)},
    )

    result = await svc.query_sessions(project_id=_PROJECT)

    assert result[0].references == row_references


@pytest.mark.asyncio
async def test_the_list_falls_back_to_the_turn_for_a_row_without_references():
    # Every session that predates the column, plus any run whose beat carried nothing.
    turn_references = [SessionReference(id=uuid4(), key=ReferenceKey.workflow)]
    svc, _ = _sessions_service([_stream("s-1")], {"s-1": _turn("s-1", turn_references)})

    result = await svc.query_sessions(project_id=_PROJECT)

    assert result[0].references == turn_references


@pytest.mark.asyncio
async def test_a_session_with_neither_lists_without_references():
    svc, _ = _sessions_service([_stream("s-1")], {})

    result = await svc.query_sessions(project_id=_PROJECT)

    assert result[0].references is None


@pytest.mark.asyncio
async def test_the_reference_filter_unions_both_reference_columns():
    """An agent-scoped list must resolve through BOTH columns, or it disagrees with what
    the list can open: a session whose turn append was dropped is findable only through
    the stream row, and one that predates that column only through its turns."""
    svc, streams_service = _sessions_service(
        [_stream("s-turn"), _stream("s-stream")],
        {},
        ids_by_turn_references=["s-turn", "s-both"],
        ids_by_stream_references=["s-stream", "s-both"],
    )

    await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(turn_references=[SessionReference(id=uuid4())]),
    )

    assert streams_service.captured_session_ids == ["s-both", "s-stream", "s-turn"]


@pytest.mark.asyncio
async def test_a_stream_only_match_reaches_the_list():
    """The whole point of the union, asserted on the returned rows rather than on the id
    set: a session no turn reference can find still comes back from `query_sessions`."""
    row_references = _references()
    svc, _ = _sessions_service(
        [_stream("s-stream-only", row_references)],
        {},
        ids_by_turn_references=[],
        ids_by_stream_references=["s-stream-only"],
    )

    result = await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(turn_references=[SessionReference(id=uuid4())]),
    )

    assert [item.session_id for item in result] == ["s-stream-only"]
    assert result[0].references == row_references


@pytest.mark.asyncio
async def test_a_reference_matching_neither_column_still_short_circuits():
    svc, streams_service = _sessions_service([], {})

    result = await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(turn_references=[SessionReference(id=uuid4())]),
    )

    assert result == []
    assert streams_service.captured_session_ids is None, (
        "an empty id set means the filter can match nothing; the row query is never run"
    )


@pytest.mark.asyncio
async def test_the_union_is_re_capped():
    # Each side is capped on its own, so their union could otherwise carry twice the
    # bound P2-12 put on this derived set.
    from oss.src.core.sessions.service import TURN_REFERENCES_SESSION_ID_CAP

    cap = TURN_REFERENCES_SESSION_ID_CAP
    svc, streams_service = _sessions_service(
        [],
        {},
        ids_by_turn_references=[f"t-{i:04d}" for i in range(cap)],
        ids_by_stream_references=[f"s-{i:04d}" for i in range(cap)],
    )

    await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(turn_references=[SessionReference(id=uuid4())]),
    )

    assert len(streams_service.captured_session_ids) == cap


@pytest.mark.asyncio
async def test_the_reference_filter_still_matches_untagged_rows():
    """`@>` is a containment match, so a filter carrying `key` would stop matching every
    row written before elements were tagged. The query flatten drops it."""
    from oss.src.core.sessions.turns.dtos import SessionTurnQuery
    from oss.src.dbs.postgres.sessions.turns.utils import query_turn_references

    reference = SessionReference(id=uuid4(), key=ReferenceKey.workflow)

    flattened = query_turn_references(SessionTurnQuery(references=[reference]))

    assert flattened == [{"id": str(reference.id)}]


def test_the_stream_filter_is_unchanged_by_the_new_column():
    # The list's row predicate never learned about references; the column is read-only
    # decoration on a row already selected.
    assert "references" not in SessionStreamQuery.model_fields
    assert SessionQueryLifecycle().include_ended is False
    assert SessionQuery().turn_references is None
