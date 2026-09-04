import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.service import RecordsService
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


def _event(
    project_id,
    session_id,
    text="",
    *,
    record_type="message",
    attributes=None,
):
    return SessionRecordEvent(
        project_id=project_id,
        session_id=session_id,
        record_id=uuid.uuid4(),
        turn_id="execution-1",
        record_type=record_type,
        record_source="agent",
        attributes=attributes or {"type": "message", "text": text},
    )


async def test_snapshot_n_followed_by_events_after_n_loses_no_commit():
    project_id = uuid.uuid4()
    session_id = f"replay-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())
    service = RecordsService(records_dao=dao)

    try:
        await dao.append(event=_event(project_id, session_id, "one"))
        snapshot = await dao.get_read_state(
            project_id=project_id, session_id=session_id
        )
        await dao.append_many(
            events=[
                _event(
                    project_id, session_id, record_type="done", attributes={"ok": True}
                ),
                _event(project_id, session_id, "three"),
                _event(
                    project_id,
                    session_id,
                    record_type="usage",
                    attributes={"tokens": 1},
                ),
                _event(
                    project_id,
                    session_id,
                    record_type="tool_call",
                    attributes={"id": "tool-1", "name": "read", "input": {}},
                ),
                _event(
                    project_id,
                    session_id,
                    record_type="tool_result",
                    attributes={"id": "tool-1", "output": "ok"},
                ),
                _event(
                    project_id,
                    session_id,
                    record_type="execution.stopped",
                    attributes={
                        "stopped_at": datetime.now(timezone.utc).isoformat(),
                        "reason": "completed",
                    },
                ),
                _event(
                    project_id,
                    session_id,
                    record_type="thought",
                    attributes={"text": "x"},
                ),
                _event(project_id, session_id, "nine"),
            ]
        )

        replay = await service.get_events_after(
            project_id=project_id,
            session_id=session_id,
            after=snapshot.latest_sequence,
        )

        assert snapshot.latest_sequence == 1
        assert [event.sequence for event in replay.events] == [3, 6, 7, 9]
        assert replay.events[0].payload.content == "three"
        assert replay.events[-1].payload.content == "nine"
        assert replay.events[-1].watermark == 9
        assert replay.watermark == 9
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


async def test_legacy_session_replays_ordered_history_and_is_incomplete():
    project_id = uuid.uuid4()
    session_id = f"legacy-{uuid.uuid4()}"
    dao = RecordsDAO(engine=get_analytics_engine())
    service = RecordsService(records_dao=dao)
    now = datetime.now(timezone.utc)

    try:
        async with get_analytics_engine().session() as session:
            session.add_all(
                [
                    RecordDBE(
                        project_id=project_id,
                        record_id=uuid.uuid4(),
                        session_id=session_id,
                        turn_id="execution-legacy",
                        record_index=index,
                        timestamp=now,
                        record_type="message",
                        record_source="agent",
                        attributes={"type": "message", "text": text},
                    )
                    for index, text in enumerate(("first", "second"))
                ]
            )

        read = await dao.get_read_state(project_id=project_id, session_id=session_id)
        replay = await service.get_events_after(
            project_id=project_id,
            session_id=session_id,
            after=0,
        )

        assert read.latest_sequence == 0
        assert read.history_complete is False
        assert replay.watermark == 0
        assert [event.sequence for event in replay.events] == [None, None]
        assert [event.payload.content for event in replay.events] == ["first", "second"]
    finally:
        async with get_analytics_engine().session() as session:
            await session.execute(
                delete(RecordDBE).where(RecordDBE.project_id == project_id)
            )
