"""The two reads behind an `agent_failure` event, against a real Postgres.

Each read must load only what the event needs: the failed turn's tool calls, and one user
message at or before the failure. A stub cannot show which rows the SQL returns.

Requires POSTGRES_URI_TRACING pointed at the tracing database.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_analytics_engine


pytestmark = pytest.mark.integration

AT = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _every_case_here_reads_the_tracing_database(the_tracing_database):
    """`RecordsDAO` is built on `get_analytics_engine()`, which reads POSTGRES_URI_TRACING."""


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


def _event(project_id, session_id, turn_id, record_type, *, minutes, **over):
    attributes = over.pop("attributes", {"type": record_type})
    return SessionRecordEvent(
        project_id=project_id,
        session_id=session_id,
        record_id=uuid.uuid4(),
        record_index=0,
        timestamp=AT + timedelta(minutes=minutes),
        record_type=record_type,
        record_source=over.pop("record_source", "agent"),
        attributes=attributes,
        turn_id=turn_id,
        **over,
    )


def _user_message(project_id, session_id, turn_id, text, *, minutes, **over):
    return _event(
        project_id,
        session_id,
        turn_id,
        "message",
        minutes=minutes,
        record_source="user",
        attributes={"type": "message", "text": text},
        **over,
    )


async def _seed(events):
    dao = RecordsDAO(engine=get_analytics_engine())
    await dao.append_many(events=events)
    return dao


async def test_the_turn_read_returns_only_that_turns_tool_calls():
    project_id, session_id = uuid.uuid4(), f"failure-read-{uuid.uuid4().hex[:8]}"
    wanted = _event(project_id, session_id, "turn-2", "tool_call", minutes=1)
    dao = await _seed(
        [
            _event(project_id, session_id, "turn-1", "tool_call", minutes=0),
            wanted,
            _event(project_id, session_id, "turn-2", "tool_result", minutes=2),
            _event(
                project_id,
                session_id,
                "turn-2",
                "tool_call",
                minutes=3,
                quarantined_at=AT,
            ),
            _user_message(project_id, session_id, "turn-2", "hi", minutes=0),
        ]
    )

    calls = await dao.get_turn_tool_calls(
        project_id=project_id, session_id=session_id, turn_id="turn-2"
    )

    assert [call.record_id for call in calls] == [wanted.record_id]


async def test_the_prompt_read_returns_the_latest_user_message_at_the_failure():
    project_id, session_id = uuid.uuid4(), f"failure-read-{uuid.uuid4().hex[:8]}"
    dao = await _seed(
        [
            _user_message(project_id, session_id, "turn-1", "first", minutes=0),
            _user_message(project_id, session_id, "turn-2", "second", minutes=5),
            _event(project_id, session_id, "turn-2", "message", minutes=6),
            _user_message(project_id, session_id, "turn-3", "after", minutes=20),
            _user_message(
                project_id, session_id, "turn-2", "late", minutes=7, quarantined_at=AT
            ),
        ]
    )

    at_failure = await dao.get_latest_user_message(
        project_id=project_id,
        session_id=session_id,
        at_or_before=AT + timedelta(minutes=10),
    )
    unbounded = await dao.get_latest_user_message(
        project_id=project_id, session_id=session_id, at_or_before=None
    )
    before_any = await dao.get_latest_user_message(
        project_id=project_id,
        session_id=session_id,
        at_or_before=AT - timedelta(minutes=1),
    )

    assert at_failure.attributes["text"] == "second"
    assert unbounded.attributes["text"] == "after"
    assert before_any is None
