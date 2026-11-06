"""The database half of a rewind, against a real Postgres.

Requires POSTGRES_URI_TRACING pointed at a database with the tracing_oss chain applied.
"""

import uuid
from datetime import datetime, timezone

import pytest

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
import oss.src.dbs.postgres.shared.engine as engine_module


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _every_case_here_reads_the_tracing_database(the_tracing_database):
    """These DAOs are built on `get_analytics_engine()`, whose address is POSTGRES_URI_TRACING."""


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


async def _log_with_three_turns(dao):
    project_id = uuid.uuid4()
    session_id = f"rewind-test-{uuid.uuid4().hex[:8]}"
    for turn_id in ("t1", "t2", "t3"):
        for index, (source, text) in enumerate((("user", "ask"), ("agent", "answer"))):
            await dao.append(
                event=SessionRecordEvent(
                    project_id=project_id,
                    session_id=session_id,
                    record_id=uuid.uuid4(),
                    record_index=index,
                    timestamp=datetime.now(timezone.utc),
                    record_type="message",
                    record_source=source,
                    attributes={"type": "message", "text": f"{turn_id} {text}"},
                    turn_id=turn_id,
                )
            )
    return project_id, session_id


async def _visible_turns(dao, project_id, session_id):
    records = await dao.get_records(project_id=project_id, session_id=session_id)
    return [record.turn_id for record in records]


@pytest.mark.asyncio
async def test_the_turn_and_every_later_turn_leave_the_log():
    dao = RecordsDAO()
    project_id, session_id = await _log_with_three_turns(dao)

    removed = await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="t2", user_id=None
    )

    assert removed == 4
    assert await _visible_turns(dao, project_id, session_id) == ["t1", "t1"]


@pytest.mark.asyncio
async def test_rewinding_the_first_turn_empties_the_log():
    dao = RecordsDAO()
    project_id, session_id = await _log_with_three_turns(dao)

    removed = await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="t1", user_id=None
    )

    assert removed == 6
    assert await _visible_turns(dao, project_id, session_id) == []


@pytest.mark.asyncio
async def test_a_second_rewind_of_the_same_turn_removes_nothing():
    dao = RecordsDAO()
    project_id, session_id = await _log_with_three_turns(dao)
    await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="t2", user_id=None
    )

    removed = await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="t2", user_id=None
    )

    assert removed == 0


@pytest.mark.asyncio
async def test_an_unknown_turn_removes_nothing():
    dao = RecordsDAO()
    project_id, session_id = await _log_with_three_turns(dao)

    removed = await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="nope", user_id=None
    )

    assert removed == 0
    assert len(await _visible_turns(dao, project_id, session_id)) == 6


@pytest.mark.asyncio
async def test_the_sequence_keeps_rising_after_a_rewind():
    dao = RecordsDAO()
    project_id, session_id = await _log_with_three_turns(dao)
    before = await dao.get_read_state(project_id=project_id, session_id=session_id)
    await dao.rewind_from_turn(
        project_id=project_id, session_id=session_id, turn_id="t2", user_id=None
    )

    await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=uuid.uuid4(),
            record_index=0,
            timestamp=datetime.now(timezone.utc),
            record_type="message",
            record_source="user",
            attributes={"type": "message", "text": "edited"},
            turn_id="t4",
        )
    )

    after = await dao.get_read_state(project_id=project_id, session_id=session_id)
    assert after.latest_sequence == before.latest_sequence + 1
    assert await _visible_turns(dao, project_id, session_id) == ["t1", "t1", "t4"]
