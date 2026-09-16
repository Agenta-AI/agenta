import uuid

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
