import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.sessions.records.dbes import (
    RecordDBE,
    SessionSequenceCursorDBE,
)
from oss.src.dbs.postgres.shared.engine import get_analytics_engine
from oss.src.utils.env import env


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture(autouse=True)
async def _fresh_analytics_engine(monkeypatch):
    monkeypatch.setattr(env.sessions, "sequence_writes", True)
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


async def test_snapshot_watermark_pages_transcript_without_admitting_later_rows():
    project_id = uuid.uuid4()
    session_id = f"snapshot-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())

    def event(text: str) -> SessionRecordEvent:
        return SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=uuid.uuid4(),
            record_type="message",
            record_source="agent",
            attributes={"type": "message", "text": text},
        )

    try:
        await dao.append_many(events=[event("one"), event("two")])
        read = await dao.get_read_state(project_id=project_id, session_id=session_id)
        assert read.latest_sequence == 2
        assert read.history_complete is True

        first = await dao.get_records_page(
            project_id=project_id,
            session_id=session_id,
            offset=0,
            limit=1,
            through_sequence=read.latest_sequence,
        )
        await dao.append(event=event("later"))
        second = await dao.get_records_page(
            project_id=project_id,
            session_id=session_id,
            offset=first.next_offset,
            limit=1,
            through_sequence=read.latest_sequence,
        )

        assert [record.sequence for record in first.records] == [1]
        assert [record.sequence for record in second.records] == [2]
        assert second.next_offset is None
    finally:
        async with get_analytics_engine().session() as session:
            await session.execute(
                delete(RecordDBE).where(RecordDBE.project_id == project_id)
            )
            await session.execute(
                delete(SessionSequenceCursorDBE).where(
                    SessionSequenceCursorDBE.project_id == project_id,
                    SessionSequenceCursorDBE.session_id == session_id,
                )
            )


def _turn_event(
    project_id,
    session_id,
    *,
    record_index,
    timestamp,
    record_type="message",
    attributes=None,
    turn_id="execution-1",
):
    return SessionRecordEvent(
        project_id=project_id,
        session_id=session_id,
        record_id=uuid.uuid4(),
        turn_id=turn_id,
        record_index=record_index,
        timestamp=timestamp,
        record_type=record_type,
        record_source="agent",
        attributes=attributes or {"type": "message"},
    )


def _tool_pair(project_id, session_id, *, call_at, result_at):
    call = _turn_event(
        project_id,
        session_id,
        record_index=0,
        timestamp=call_at,
        record_type="tool_call",
        attributes={"id": "tool-1", "name": "read", "input": {}},
    )
    result = _turn_event(
        project_id,
        session_id,
        record_index=1,
        timestamp=result_at,
        record_type="tool_result",
        attributes={"id": "tool-1", "output": "ok"},
    )
    return call, result


async def _cleanup(project_id, session_id):
    async with get_analytics_engine().session() as session:
        await session.execute(
            delete(RecordDBE).where(RecordDBE.project_id == project_id)
        )
        await session.execute(
            delete(SessionSequenceCursorDBE).where(
                SessionSequenceCursorDBE.project_id == project_id,
                SessionSequenceCursorDBE.session_id == session_id,
            )
        )


async def _read_all(dao, project_id, session_id, *, limit):
    read = await dao.get_read_state(project_id=project_id, session_id=session_id)
    records, offset = [], 0
    while offset is not None:
        page = await dao.get_records_page(
            project_id=project_id,
            session_id=session_id,
            offset=offset,
            limit=limit,
            through_sequence=read.latest_sequence,
        )
        records.extend(page.records)
        offset = page.next_offset
    return records


async def test_tool_result_committed_before_its_call_reads_after_the_call():
    """Two record workers race, so a tool_result can take a lower sequence than its
    tool_call. Transcript reads follow the runner's send order, not the commit order."""
    project_id = uuid.uuid4()
    session_id = f"send-order-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())
    sent_at = datetime.now(timezone.utc)
    call, result = _tool_pair(
        project_id,
        session_id,
        call_at=sent_at,
        result_at=sent_at + timedelta(milliseconds=5),
    )

    try:
        await dao.append(event=result)
        await dao.append(event=call)

        for limit in (1, 100):
            paged = await _read_all(dao, project_id, session_id, limit=limit)
            assert [r.record_id for r in paged] == [call.record_id, result.record_id]
            assert [r.sequence for r in paged] == [2, 1]

        full = await dao.get_records(project_id=project_id, session_id=session_id)
        assert [r.record_id for r in full] == [call.record_id, result.record_id]
    finally:
        await _cleanup(project_id, session_id)


async def test_same_millisecond_records_read_in_record_index_order():
    """`created_at` is the worker's commit time, so on a timestamp tie it would bring the
    race back. `record_index` decides first."""
    project_id = uuid.uuid4()
    session_id = f"send-order-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())
    sent_at = datetime.now(timezone.utc)
    call, result = _tool_pair(
        project_id, session_id, call_at=sent_at, result_at=sent_at
    )

    try:
        await dao.append(event=result)
        await dao.append(event=call)

        paged = await _read_all(dao, project_id, session_id, limit=1)
        assert [r.record_id for r in paged] == [call.record_id, result.record_id]

        full = await dao.get_records(project_id=project_id, session_id=session_id)
        assert [r.record_id for r in full] == [call.record_id, result.record_id]
    finally:
        await _cleanup(project_id, session_id)


async def test_rows_without_sequence_stay_first(monkeypatch):
    project_id = uuid.uuid4()
    session_id = f"send-order-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())
    sent_at = datetime.now(timezone.utc)
    legacy = _turn_event(
        project_id,
        session_id,
        record_index=0,
        timestamp=sent_at + timedelta(seconds=10),
        turn_id="execution-legacy",
    )
    sequenced = _turn_event(project_id, session_id, record_index=0, timestamp=sent_at)

    try:
        monkeypatch.setattr(env.sessions, "sequence_writes", False)
        await dao.append(event=legacy)
        monkeypatch.setattr(env.sessions, "sequence_writes", True)
        await dao.append(event=sequenced)

        paged = await _read_all(dao, project_id, session_id, limit=1)
        assert [r.record_id for r in paged] == [legacy.record_id, sequenced.record_id]
        assert [r.sequence for r in paged] == [None, 1]

        full = await dao.get_records(project_id=project_id, session_id=session_id)
        assert [r.record_id for r in full] == [legacy.record_id, sequenced.record_id]
    finally:
        await _cleanup(project_id, session_id)
