import asyncio
import uuid

import pytest
from sqlalchemy import delete, select

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


@pytest.fixture(autouse=True)
async def _fresh_analytics_engine(monkeypatch):
    monkeypatch.setattr(env.sessions, "sequence_writes", True)
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


async def test_concurrent_inserts_allocate_distinct_sequences_and_retry_keeps_cursor():
    project_id = uuid.uuid4()
    session_id = f"sequence-{uuid.uuid4()}"
    record_ids = [uuid.uuid4(), uuid.uuid4()]
    dao = RecordsDAO(engine=get_analytics_engine())

    def event(record_id: uuid.UUID, text: str) -> SessionRecordEvent:
        return SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=record_id,
            record_type="message",
            record_source="agent",
            attributes={"type": "message", "text": text},
        )

    try:
        first, second = await asyncio.gather(
            dao.append(event=event(record_ids[0], "first")),
            dao.append(event=event(record_ids[1], "second")),
        )
        assert sorted([first.sequence, second.sequence]) == [1, 2]

        retried = await dao.append(event=event(record_ids[0], "first"))
        assert retried.sequence == first.sequence

        async with get_analytics_engine().session() as session:
            cursor = await session.scalar(
                select(SessionSequenceCursorDBE.latest_sequence).where(
                    SessionSequenceCursorDBE.session_id == session_id
                )
            )
            sequences = list(
                (
                    await session.scalars(
                        select(RecordDBE.sequence)
                        .where(RecordDBE.session_id == session_id)
                        .order_by(RecordDBE.sequence)
                    )
                ).all()
            )
        assert cursor == 2
        assert sequences == [1, 2]
    finally:
        async with get_analytics_engine().session() as session:
            await session.execute(
                delete(RecordDBE).where(RecordDBE.project_id == project_id)
            )
            await session.execute(
                delete(SessionSequenceCursorDBE).where(
                    SessionSequenceCursorDBE.session_id == session_id
                )
            )
