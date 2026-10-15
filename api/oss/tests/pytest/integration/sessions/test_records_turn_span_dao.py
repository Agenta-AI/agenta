"""Integration-style tests for records turn_id/span_id tagging against a real Postgres.

Requires the tracing_oss migration chain applied (through oss000000003_add_records_turn_span)
and POSTGRES_URI_TRACING pointed at that database. Records have no FK to any other table
(cross-DB, plain columns), so no fixture chain is needed beyond project_id/session_id.

Verifies:
  - a new record carries turn_id (and span_id when supplied);
  - records group by turn_id (client-side grouping over get_records, since there is no
    server-side aggregate endpoint);
  - span_id is populated when present on the event, null otherwise;
  - old records (turn_id/span_id both null, as if written before this column existed)
    are still readable under the session, alongside newer tagged ones.
"""

import uuid
from datetime import datetime, timezone

import pytest

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_analytics_engine


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    """Each pytest-asyncio test gets its own event loop; the module-level engine
    singleton binds its asyncpg pool to the first loop that touches it. Reset it
    so every test starts with a pool bound to its own loop."""
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


def _ids():
    return uuid.uuid4(), f"records-turn-span-test-{uuid.uuid4().hex[:8]}"


async def test_new_record_carries_turn_id_and_span_id():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    # 16-hex OTel span id (runner shape), NOT a UUID.
    span_id = uuid.uuid4().hex[:16]
    dao = RecordsDAO(engine=get_analytics_engine())

    record = await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=0,
            record_type="message",
            record_source="agent",
            attributes={"text": "hello"},
            turn_id=turn_id,
            span_id=span_id,
        )
    )

    assert record is not None
    assert record.turn_id == turn_id
    assert record.span_id == span_id

    fetched = await dao.get_records(project_id=project_id, session_id=session_id)
    assert len(fetched) == 1
    assert fetched[0].turn_id == turn_id
    assert fetched[0].span_id == span_id


async def test_span_id_null_when_not_supplied():
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    record = await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=0,
            record_type="message",
            record_source="agent",
            attributes={"text": "no span here"},
            turn_id=turn_id,
        )
    )

    assert record is not None
    assert record.turn_id == turn_id
    assert record.span_id is None


async def test_records_group_by_turn_id():
    """No server-side aggregate endpoint (E1) — group-by-turn is client-side grouping
    over get_records, which returns turn_id on every row for exactly this purpose."""
    project_id, session_id = _ids()
    turn_a = f"turn-a-{uuid.uuid4().hex[:8]}"
    turn_b = f"turn-b-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    events = [
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=0,
            record_type="message",
            record_source="user",
            attributes={"text": "turn a msg 1"},
            turn_id=turn_a,
        ),
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=1,
            record_type="message",
            record_source="agent",
            attributes={"text": "turn a msg 2"},
            turn_id=turn_a,
        ),
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=0,
            record_type="message",
            record_source="user",
            attributes={"text": "turn b msg 1"},
            turn_id=turn_b,
        ),
    ]
    await dao.append_many(events=events)

    fetched = await dao.get_records(project_id=project_id, session_id=session_id)
    assert len(fetched) == 3

    grouped: dict = {}
    for r in fetched:
        grouped.setdefault(r.turn_id, []).append(r)

    assert set(grouped.keys()) == {turn_a, turn_b}
    assert len(grouped[turn_a]) == 2
    assert len(grouped[turn_b]) == 1


async def test_old_records_with_null_turn_id_still_readable_under_session():
    """Forward-fill only (tracing-DB rule, no backfill): a record written without
    turn_id/span_id (simulating a pre-WP4 row) stays null and is still readable
    alongside newer tagged records under the same session."""
    project_id, session_id = _ids()
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    dao = RecordsDAO(engine=get_analytics_engine())

    # "Old" record: no turn_id/span_id at all, as pre-WP4 producers would have sent.
    old_record = await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=0,
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            record_type="message",
            record_source="user",
            attributes={"text": "pre-existing record"},
        )
    )
    # "New" record: carries both.
    new_record = await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_index=1,
            record_type="message",
            record_source="agent",
            attributes={"text": "post-WP4 record"},
            turn_id=turn_id,
            span_id=uuid.uuid4().hex[:16],
        )
    )

    assert old_record.turn_id is None
    assert old_record.span_id is None
    assert new_record.turn_id == turn_id

    fetched = await dao.get_records(project_id=project_id, session_id=session_id)
    ids = {r.record_id for r in fetched}
    assert old_record.record_id in ids
    assert new_record.record_id in ids

    by_id = {r.record_id: r for r in fetched}
    assert by_id[old_record.record_id].turn_id is None
    assert by_id[new_record.record_id].turn_id == turn_id
