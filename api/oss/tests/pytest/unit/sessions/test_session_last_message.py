"""Unit tests for the session list's last-message preview.

A session row used to carry a title and a timestamp, so deciding whether a session was worth
reopening meant opening it. The preview closes that, under one constraint: it must cost the
list ONE query, not one per row — the alternative (`POST /sessions/records/query` per row) is
the fan-out the sessions router's module docstring rules out.

(a) DAO-level: statement compilation only (no DB), mirroring `test_query_sessions_filters.py`.
(b) Service-level: fake services, asserting the preview is a single batched call keyed on the
    whole page and that a deployment without the records engine still lists sessions.
"""

import asyncio
from typing import Dict, List, Optional
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import (
    SessionExpansion,
    SessionQuery,
    SessionQueryOptions,
)
from oss.src.core.sessions.records.dtos import SessionMessagePreview
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.dbs.postgres.sessions.records import dao as records_dao_module


# ---------------------------------------------------------------------------------- #
# (a) DAO — statement compilation
# ---------------------------------------------------------------------------------- #


class _DummyResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _DummySession:
    def __init__(self, rows=()):
        self.captured_stmt = None
        self._rows = list(rows)

    async def execute(self, stmt):
        self.captured_stmt = stmt
        return _DummyResult(self._rows)


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Row:
    """Mirrors the columns the DAO's `select(...)` now projects: `text` is already
    the truncated `left(attributes->>'text', ...)` expression, not the raw
    `attributes` blob — the fake session below skips real SQL execution, so it
    must hand back what the query would have computed, not the pre-image."""

    def __init__(self, session_id, record_source, text, timestamp=None):
        self.session_id = session_id
        self.record_source = record_source
        self.text = text
        self.timestamp = timestamp
        self.created_at = None


def _dao(rows=()):
    session = _DummySession(rows)
    engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    return records_dao_module.RecordsDAO(engine=engine), session


@pytest.mark.asyncio
async def test_preview_is_one_distinct_on_query_for_the_whole_page():
    dao, session = _dao()

    await dao.latest_message_per_session(
        project_id=uuid4(), session_ids=["a", "b", "c"]
    )

    sql = str(session.captured_stmt.compile(dialect=postgresql.dialect())).replace(
        "\n", " "
    )

    # One statement, one row per session — not three round-trips.
    assert "DISTINCT ON (records.session_id)" in sql
    assert "records.session_id IN" in sql


@pytest.mark.asyncio
async def test_preview_reads_messages_only():
    # `done`/`usage` are bookkeeping and `thought` is not addressed to anyone; a row previewing
    # either says nothing about what happened.
    dao, session = _dao()

    await dao.latest_message_per_session(project_id=uuid4(), session_ids=["a"])

    compiled = session.captured_stmt.compile(dialect=postgresql.dialect())

    assert "records.record_type" in str(compiled).replace("\n", " ")
    assert "message" in compiled.params.values()


@pytest.mark.asyncio
async def test_newest_message_wins_on_producer_event_time():
    # `record_index` restarts every turn, so ordering on it alone would preview the newest
    # message OF THE FIRST TURN once a session has more than one.
    dao, session = _dao()

    await dao.latest_message_per_session(project_id=uuid4(), session_ids=["a"])

    sql = str(session.captured_stmt.compile(dialect=postgresql.dialect())).replace(
        "\n", " "
    )

    assert "ORDER BY records.session_id, records.timestamp DESC NULLS LAST" in sql


@pytest.mark.asyncio
async def test_text_is_checked_after_newest_message_selection_without_fallback():
    dao, session = _dao()

    await dao.latest_message_per_session(project_id=uuid4(), session_ids=["a"])

    sql = str(session.captured_stmt.compile(dialect=postgresql.dialect())).replace(
        "\n", " "
    )
    where_clause = sql.split(" WHERE ", 1)[1].split(" ORDER BY ", 1)[0]

    # Row selection (WHERE + DISTINCT ON + ORDER BY) never filters on message
    # content — `text` is only ever projected (truncated) in the SELECT list, so a
    # message with no/blank text is still the newest row chosen, and gets skipped
    # in Python afterward rather than falling back to an older row that has text.
    assert "text" not in where_clause


@pytest.mark.asyncio
async def test_no_ids_asks_the_database_nothing():
    dao, session = _dao()

    assert (
        await dao.latest_message_per_session(project_id=uuid4(), session_ids=[]) == {}
    )
    assert session.captured_stmt is None


@pytest.mark.asyncio
async def test_a_message_without_text_has_nothing_to_preview():
    # An attachment-only message carries no `text`; a row must not preview an empty string.
    dao, _ = _dao(
        rows=[
            _Row("with-text", "user", "  ship it  "),
            _Row("no-text", "agent", None),
            _Row("blank", "agent", "   "),
            _Row("no-attributes", "agent", None),
        ]
    )

    previews = await dao.latest_message_per_session(
        project_id=uuid4(),
        session_ids=["with-text", "no-text", "blank", "no-attributes"],
    )

    assert set(previews) == {"with-text"}
    assert previews["with-text"].text == "ship it"
    assert previews["with-text"].source == "user"


# ---------------------------------------------------------------------------------- #
# (b) Service — batching and graceful absence
# ---------------------------------------------------------------------------------- #


class _FakeStreamsService:
    def __init__(self, streams):
        self._streams = streams

    async def query_streams(self, **kwargs):
        return self._streams


class _FakeTurnsService:
    def __init__(self):
        self.calls = 0

    async def latest_turn_per_session(self, **kwargs):
        self.calls += 1
        return {}


class _FakeRecordsService:
    def __init__(self, previews: Dict[str, SessionMessagePreview]):
        self._previews = previews
        self.calls: List[Optional[List[str]]] = []

    async def latest_message_per_session(self, *, project_id, session_ids):
        self.calls.append(list(session_ids))
        return self._previews


def _stream(session_id: str) -> SessionStream:
    return SessionStream(project_id=uuid4(), session_id=session_id)


def _service(records_service=None) -> SessionsService:
    return SessionsService(
        streams_service=_FakeStreamsService([_stream("a"), _stream("b")]),
        turns_service=_FakeTurnsService(),
        interactions_service=object(),
        mounts_service=object(),
        records_service=records_service,
    )


@pytest.mark.asyncio
async def test_the_whole_page_is_previewed_in_one_call():
    records = _FakeRecordsService(
        {"a": SessionMessagePreview(text="ship it", source="user")}
    )

    items = await _service(records).query_sessions(
        project_id=uuid4(),
        query=SessionQuery(),
        options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
    )

    assert records.calls == [["a", "b"]]
    assert items[0].last_message.text == "ship it"
    # A session with no message yet is a row without a preview, not a missing row.
    assert items[1].last_message is None


@pytest.mark.asyncio
async def test_sessions_still_list_without_the_records_engine():
    items = await _service(records_service=None).query_sessions(
        project_id=uuid4(),
        query=SessionQuery(),
        options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
    )

    assert [item.session_id for item in items] == ["a", "b"]
    assert all(item.last_message is None for item in items)


@pytest.mark.asyncio
async def test_no_expansion_skips_records_but_still_loads_latest_turns():
    records = _FakeRecordsService({})
    service = _service(records)

    items = await service.query_sessions(project_id=uuid4(), query=SessionQuery())

    assert [item.session_id for item in items] == ["a", "b"]
    assert records.calls == []
    assert service.turns_service.calls == 1


@pytest.mark.asyncio
async def test_preview_and_latest_turn_batches_start_concurrently():
    turns_started = asyncio.Event()
    records_started = asyncio.Event()

    class _ConcurrentTurns:
        async def latest_turn_per_session(self, **kwargs):
            turns_started.set()
            await records_started.wait()
            return {}

    class _ConcurrentRecords:
        async def latest_message_per_session(self, **kwargs):
            records_started.set()
            await turns_started.wait()
            return {"a": SessionMessagePreview(text="concurrent")}

    service = SessionsService(
        streams_service=_FakeStreamsService([_stream("a")]),
        turns_service=_ConcurrentTurns(),
        interactions_service=object(),
        mounts_service=object(),
        records_service=_ConcurrentRecords(),
    )

    items = await asyncio.wait_for(
        service.query_sessions(
            project_id=uuid4(),
            options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
        ),
        timeout=1,
    )

    assert items[0].last_message.text == "concurrent"


@pytest.mark.asyncio
async def test_records_failure_returns_base_rows_without_previews():
    class _FailingRecords:
        async def latest_message_per_session(self, **kwargs):
            raise RuntimeError("analytics unavailable")

    items = await _service(_FailingRecords()).query_sessions(
        project_id=uuid4(),
        options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
    )

    assert [item.session_id for item in items] == ["a", "b"]
    assert all(item.last_message is None for item in items)


@pytest.mark.asyncio
async def test_latest_turn_failure_still_propagates_with_preview_expansion():
    class _FailingTurns:
        async def latest_turn_per_session(self, **kwargs):
            raise RuntimeError("turn lookup failed")

    service = SessionsService(
        streams_service=_FakeStreamsService([_stream("a")]),
        turns_service=_FailingTurns(),
        interactions_service=object(),
        mounts_service=object(),
        records_service=_FakeRecordsService({}),
    )

    with pytest.raises(RuntimeError, match="turn lookup failed"):
        await service.query_sessions(
            project_id=uuid4(),
            options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
        )


@pytest.mark.asyncio
async def test_latest_turn_failure_cancels_and_awaits_records_lookup():
    records_started = asyncio.Event()
    records_cancelled = asyncio.Event()
    records_cleanup_finished = asyncio.Event()

    class _FailingTurns:
        async def latest_turn_per_session(self, **kwargs):
            await records_started.wait()
            raise RuntimeError("turn lookup failed")

    class _CancellableRecords:
        async def latest_message_per_session(self, **kwargs):
            records_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                records_cancelled.set()
                await asyncio.sleep(0)
                records_cleanup_finished.set()
                raise

    service = SessionsService(
        streams_service=_FakeStreamsService([_stream("a")]),
        turns_service=_FailingTurns(),
        interactions_service=object(),
        mounts_service=object(),
        records_service=_CancellableRecords(),
    )

    with pytest.raises(RuntimeError, match="turn lookup failed"):
        await service.query_sessions(
            project_id=uuid4(),
            options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
        )

    assert records_cancelled.is_set()
    assert records_cleanup_finished.is_set()


def test_public_preview_has_no_session_id():
    preview = SessionMessagePreview(text="ship it", source="user")

    assert preview.model_dump() == {
        "text": "ship it",
        "source": "user",
        "timestamp": None,
    }
    assert "session_id" not in SessionMessagePreview.model_json_schema()["properties"]
