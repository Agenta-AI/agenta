from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import (
    SessionExpansion,
    SessionQueryOptions,
    SessionTriggerKind,
)
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQuery,
    SessionStreamQueryResult,
    SessionStreamReadOptions,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.types import SessionTrigger
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO


def _compiled_query(*, include_trigger_details: bool) -> str:
    statement = SessionStreamsDAO._query_select(
        read_options=SessionStreamReadOptions(
            include_trigger_details=include_trigger_details
        )
    )
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).replace("\n", " ")


def test_trigger_joins_are_absent_without_expansion():
    sql = _compiled_query(include_trigger_details=False)

    assert "trigger_schedules" not in sql
    assert "trigger_subscriptions" not in sql


def test_trigger_expansion_joins_both_configuration_tables_by_typed_identity():
    sql = _compiled_query(include_trigger_details=True)

    assert "LEFT OUTER JOIN trigger_schedules" in sql
    assert "LEFT OUTER JOIN trigger_subscriptions" in sql
    assert "trigger_schedules.project_id = session_streams.project_id" in sql
    assert "trigger_subscriptions.project_id = session_streams.project_id" in sql
    assert "trigger_schedules.id = CASE WHEN" in sql
    assert "trigger_subscriptions.id = CASE WHEN" in sql
    assert "ag.trigger.kind" in sql
    # Not `"schedule" in sql` / `"subscription" in sql` — the table names
    # `trigger_schedules`/`trigger_subscriptions` (already asserted above)
    # contain both substrings, so those checks would pass even if the CASE
    # predicate's literal comparison were deleted. Assert the literal itself.
    assert "= 'schedule'" in sql
    assert "= 'subscription'" in sql
    assert "ag.trigger.id" in sql
    assert " AS UUID" in sql
    assert "trigger_schedules.deleted_at" not in sql
    assert "trigger_subscriptions.deleted_at" not in sql
    assert "trigger_subscriptions.trigger_id" not in sql
    assert "CAST(trigger_schedules.id" not in sql
    assert "CAST(trigger_subscriptions.id" not in sql


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _EmptyResult:
    def all(self):
        return []


class _CountingSession:
    def __init__(self, error=None):
        self.error = error
        self.execute_calls = 0
        self.statement = None

    async def execute(self, statement):
        self.execute_calls += 1
        self.statement = statement
        if self.error:
            raise self.error
        return _EmptyResult()


def _dao_with_session(session):
    engine = type("Engine", (), {"session": lambda self: _SessionContext(session)})()
    return SessionStreamsDAO(engine=engine)


@pytest.mark.asyncio
async def test_trigger_expansion_executes_one_joined_stream_statement():
    session = _CountingSession()

    result = await _dao_with_session(session).query(
        project_id=uuid4(),
        filter=SessionStreamQuery(),
        read_options=SessionStreamReadOptions(include_trigger_details=True),
    )

    assert result == []
    assert session.execute_calls == 1
    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "LEFT OUTER JOIN trigger_schedules" in sql
    assert "LEFT OUTER JOIN trigger_subscriptions" in sql


@pytest.mark.asyncio
async def test_joined_stream_failure_propagates_without_fallback_query():
    session = _CountingSession(error=RuntimeError("stream database unavailable"))

    with pytest.raises(RuntimeError, match="stream database unavailable"):
        await _dao_with_session(session).query(
            project_id=uuid4(),
            filter=SessionStreamQuery(),
            read_options=SessionStreamReadOptions(include_trigger_details=True),
        )

    assert session.execute_calls == 1


class _ProjectionDAO:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def query(self, **kwargs):
        self.calls.append(kwargs)
        return [self.result]


@pytest.mark.asyncio
async def test_stream_service_hydrates_name_without_changing_stream_query_shape():
    trigger_id = uuid4()
    stream = SessionStream(
        id=uuid4(),
        project_id=uuid4(),
        session_id="session-a",
        trigger=SessionTrigger(
            id=trigger_id,
            kind=SessionTriggerKind.schedule,
        ),
    )
    dao = _ProjectionDAO(
        SessionStreamQueryResult(stream=stream, trigger_name="Current name")
    )
    service = SessionStreamsService(streams_dao=dao, lock_engine=object())

    result = await service.query_streams(
        project_id=stream.project_id,
        filter=SessionStreamQuery(),
        read_options=SessionStreamReadOptions(include_trigger_details=True),
    )

    assert result == [
        stream.model_copy(
            update={
                "trigger": stream.trigger.model_copy(update={"name": "Current name"})
            }
        )
    ]
    assert dao.calls[0]["read_options"].include_trigger_details is True


@pytest.mark.asyncio
async def test_missing_trigger_name_preserves_typed_id_and_kind():
    trigger_id = uuid4()
    stream = SessionStream(
        id=uuid4(),
        project_id=uuid4(),
        session_id="session-a",
        trigger=SessionTrigger(
            id=trigger_id,
            kind=SessionTriggerKind.subscription,
        ),
    )
    service = SessionStreamsService(
        streams_dao=_ProjectionDAO(SessionStreamQueryResult(stream=stream)),
        lock_engine=object(),
    )

    result = await service.query_streams(
        project_id=stream.project_id,
        filter=SessionStreamQuery(),
        read_options=SessionStreamReadOptions(include_trigger_details=True),
    )

    assert result[0].trigger.id == trigger_id
    assert result[0].trigger.kind == SessionTriggerKind.subscription
    assert result[0].trigger.name is None


class _RootStreams:
    def __init__(self, stream):
        self.stream = stream
        self.calls = []

    async def query_streams(self, **kwargs):
        self.calls.append(kwargs)
        return [self.stream]


class _RootTurns:
    async def latest_turn_per_session(self, **kwargs):
        return {}


@pytest.mark.asyncio
async def test_root_trigger_expansion_requests_trigger_details_from_stream_read():
    stream = SessionStream(id=uuid4(), project_id=uuid4(), session_id="session-trigger")
    streams = _RootStreams(stream)
    service = SessionsService(
        streams_service=streams,
        turns_service=_RootTurns(),
        interactions_service=object(),
        mounts_service=object(),
    )

    await service.query_sessions(
        project_id=stream.project_id,
        options=SessionQueryOptions(expand=[SessionExpansion.trigger]),
    )

    assert streams.calls[0]["read_options"].include_trigger_details is True
