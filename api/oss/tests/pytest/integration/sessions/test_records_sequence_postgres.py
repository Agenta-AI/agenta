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
    # Close whatever an earlier module left behind; teardown only knows this fixture's engine.
    previous = engine_module._analytics_engine
    if previous is not None:
        await previous.close()
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
                    SessionSequenceCursorDBE.project_id == project_id,
                    SessionSequenceCursorDBE.session_id == session_id,
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
                    SessionSequenceCursorDBE.project_id == project_id,
                    SessionSequenceCursorDBE.session_id == session_id,
                )
            )


async def test_sequence_allocation_is_scoped_by_project():
    project_ids = [uuid.uuid4(), uuid.uuid4()]
    session_id = f"shared-session-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())

    try:
        records = []
        for project_id in project_ids:
            records.append(
                await dao.append(
                    event=SessionRecordEvent(
                        project_id=project_id,
                        session_id=session_id,
                        record_id=uuid.uuid4(),
                        record_type="message",
                        record_source="agent",
                        attributes={"type": "message", "text": "hello"},
                    )
                )
            )

        assert [record.sequence for record in records] == [1, 1]

        async with get_analytics_engine().session() as session:
            cursors = list(
                (
                    await session.scalars(
                        select(SessionSequenceCursorDBE.latest_sequence)
                        .where(
                            SessionSequenceCursorDBE.project_id.in_(project_ids),
                            SessionSequenceCursorDBE.session_id == session_id,
                        )
                        .order_by(SessionSequenceCursorDBE.project_id)
                    )
                ).all()
            )

        assert cursors == [1, 1]
    finally:
        async with get_analytics_engine().session() as session:
            await session.execute(
                delete(RecordDBE).where(RecordDBE.project_id.in_(project_ids))
            )
            await session.execute(
                delete(SessionSequenceCursorDBE).where(
                    SessionSequenceCursorDBE.project_id.in_(project_ids),
                    SessionSequenceCursorDBE.session_id == session_id,
                )
            )


async def test_reverse_order_batches_lock_sessions_without_deadlock(monkeypatch):
    project_id = uuid.uuid4()
    session_ids = [f"lock-a-{uuid.uuid4()}", f"lock-b-{uuid.uuid4()}"]
    dao = RecordsDAO(engine=get_analytics_engine())
    original_append = RecordsDAO._append_sequenced
    append_counts = {}

    async def append_with_first_lock_pause(*, values, session):
        record = await original_append(values=values, session=session)
        task = asyncio.current_task()
        append_counts[task] = append_counts.get(task, 0) + 1
        if append_counts[task] == 1:
            await asyncio.sleep(0.1)
        return record

    monkeypatch.setattr(
        RecordsDAO,
        "_append_sequenced",
        staticmethod(append_with_first_lock_pause),
    )

    def event(session_id: str, record_index: int) -> SessionRecordEvent:
        return SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=uuid.uuid4(),
            record_index=record_index,
            record_type="message",
            record_source="agent",
            attributes={"type": "message", "text": session_id},
        )

    first_batch = [event(session_ids[0], 0), event(session_ids[1], 0)]
    second_batch = [event(session_ids[1], 1), event(session_ids[0], 1)]

    try:
        first, second = await asyncio.wait_for(
            asyncio.gather(
                dao.append_many(events=first_batch),
                dao.append_many(events=second_batch),
            ),
            timeout=5,
        )

        assert len(first) == 2
        assert len(second) == 2
        async with get_analytics_engine().session() as session:
            rows = (
                await session.execute(
                    select(RecordDBE.session_id, RecordDBE.sequence)
                    .where(RecordDBE.project_id == project_id)
                    .order_by(RecordDBE.session_id, RecordDBE.sequence)
                )
            ).all()
        assert rows == [
            (session_ids[0], 1),
            (session_ids[0], 2),
            (session_ids[1], 1),
            (session_ids[1], 2),
        ]
    finally:
        async with get_analytics_engine().session() as session:
            await session.execute(
                delete(RecordDBE).where(RecordDBE.project_id == project_id)
            )
            await session.execute(
                delete(SessionSequenceCursorDBE).where(
                    SessionSequenceCursorDBE.project_id == project_id,
                    SessionSequenceCursorDBE.session_id.in_(session_ids),
                )
            )
