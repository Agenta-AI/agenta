"""The database half of the late-record guard, against a real Postgres.

The service decides WHICH records are late (`test_late_record_quarantine.py`, no database
needed). These tests pin what the mark then does, and none of it is visible from a stub:

  - a quarantined row is invisible to `get_records`, which is the read every transcript
    reconstruction goes through, so one execution renders one ending;
  - a quarantined row does not answer `settled_turns`, so a late `done` can never stand in
    for the real ending and suppress the watchdog's next pass;
  - `settled_by` narrows `settled_turns` to one writer;
  - the upsert coalesces `quarantined_at`, so a redelivery keeps the first mark and can never
    resurrect a row into the transcript.

Requires the tracing_oss chain through oss000000005_add_records_quarantined_at, with
POSTGRES_URI_TRACING pointed at that database.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SETTLED_BY_WATCHDOG,
    SessionRecordEvent,
)
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_analytics_engine


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    """Each pytest-asyncio test gets its own event loop; the module-level engine singleton
    binds its asyncpg pool to the first loop that touches it."""
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


def _ids():
    return uuid.uuid4(), f"late-record-test-{uuid.uuid4().hex[:8]}"


def _event(project_id, session_id, turn_id, record_type, **over):
    base = dict(
        project_id=project_id,
        session_id=session_id,
        record_id=uuid.uuid4(),
        record_index=0,
        record_type=record_type,
        record_source="agent",
        attributes={"type": record_type},
        turn_id=turn_id,
    )
    base.update(over)
    return SessionRecordEvent(**base)


def _watchdog_done(project_id, session_id, turn_id):
    return _event(
        project_id,
        session_id,
        turn_id,
        "done",
        record_index=1,
        attributes={"type": "done", RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG},
    )


async def test_a_quarantined_record_is_absent_from_the_transcript():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.append_many(
        events=[
            _event(project_id, session_id, turn_id, "message", record_index=0),
            _watchdog_done(project_id, session_id, turn_id),
            _event(
                project_id,
                session_id,
                turn_id,
                "tool_call",
                record_index=2,
                quarantined_at=datetime.now(timezone.utc),
            ),
            _event(
                project_id,
                session_id,
                turn_id,
                "done",
                record_index=3,
                quarantined_at=datetime.now(timezone.utc),
            ),
        ]
    )

    rows = await dao.get_records(project_id=project_id, session_id=session_id)

    assert [row.record_type for row in rows] == ["message", "done"]
    # Exactly one ending, and it is the watchdog's.
    endings = [row for row in rows if row.record_type == "done"]
    assert len(endings) == 1
    assert endings[0].attributes[RECORD_SETTLED_BY_ATTRIBUTE] == SETTLED_BY_WATCHDOG


async def test_a_quarantined_terminal_record_does_not_settle_its_turn():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.append_many(
        events=[
            _event(
                project_id,
                session_id,
                turn_id,
                "done",
                quarantined_at=datetime.now(timezone.utc),
            )
        ]
    )

    settled = await dao.settled_turns(
        project_id=project_id, keys=[(session_id, turn_id)]
    )

    assert settled == set()


async def test_settled_by_narrows_the_answer_to_one_writer():
    project_id, session_id = _ids()
    runner_turn = f"turn-{uuid.uuid4().hex[:8]}"
    watchdog_turn = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.append_many(
        events=[
            _event(project_id, session_id, runner_turn, "done"),
            _watchdog_done(project_id, session_id, watchdog_turn),
        ]
    )

    keys = [(session_id, runner_turn), (session_id, watchdog_turn)]

    # The watchdog's own idempotency question: has this turn ANY ending?
    assert await dao.settled_turns(project_id=project_id, keys=keys) == set(keys)
    # The ingest guard's question: did the PLATFORM end this turn?
    assert await dao.settled_turns(
        project_id=project_id, keys=keys, settled_by=SETTLED_BY_WATCHDOG
    ) == {(session_id, watchdog_turn)}


@pytest.mark.parametrize("stop_reason", ["paused", "cancelled", "error"])
async def test_runner_completion_excludes_non_success_terminal_reasons(stop_reason):
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.append_many(
        events=[
            _event(
                project_id,
                session_id,
                turn_id,
                "done",
                attributes={"type": "done", "stopReason": stop_reason},
            )
        ]
    )

    assert await dao.runner_completed_turns(
        project_id=project_id, keys=[(session_id, turn_id)]
    ) == set()


async def test_a_redelivery_keeps_the_first_quarantine_instant():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    first_mark = datetime(2026, 9, 3, 12, 0, 0, tzinfo=timezone.utc)
    event = _event(project_id, session_id, turn_id, "usage", quarantined_at=first_mark)

    await dao.append_many(events=[event])
    later = event.model_copy(
        update={"quarantined_at": datetime(2026, 9, 3, 13, 0, 0, tzinfo=timezone.utc)}
    )
    rows = await dao.append_many(events=[later])

    assert rows[0].quarantined_at == first_mark


async def test_an_unmarked_redelivery_cannot_resurrect_a_quarantined_record():
    """Quarantine is one-way. A delivery that somehow arrives unguarded must not undo it."""
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    mark = datetime.now(timezone.utc)
    event = _event(project_id, session_id, turn_id, "tool_call", quarantined_at=mark)
    await dao.append_many(events=[event])

    await dao.append_many(events=[event.model_copy(update={"quarantined_at": None})])

    rows = await dao.get_records(project_id=project_id, session_id=session_id)
    assert rows == []


async def test_an_ordinary_record_is_still_written_and_read_unmarked():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.append_many(
        events=[
            _event(project_id, session_id, turn_id, "message", record_index=0),
            _event(project_id, session_id, turn_id, "done", record_index=1),
        ]
    )

    rows = await dao.get_records(project_id=project_id, session_id=session_id)

    assert [row.record_type for row in rows] == ["message", "done"]
    assert all(row.quarantined_at is None for row in rows)


async def test_a_quarantined_message_never_becomes_the_session_preview():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    now = datetime.now(timezone.utc)
    await dao.append_many(
        events=[
            _event(
                project_id,
                session_id,
                turn_id,
                "message",
                attributes={"type": "message", "text": "the real last message"},
                timestamp=now,
            ),
            _event(
                project_id,
                session_id,
                turn_id,
                "message",
                attributes={"type": "message", "text": "written after the ending"},
                # Newer than the real one: without the filter this would win the preview.
                timestamp=now + timedelta(seconds=10),
                quarantined_at=now,
            ),
        ]
    )

    previews = await dao.latest_message_per_session(
        project_id=project_id, session_ids=[session_id]
    )

    assert previews[session_id].text == "the real last message"
