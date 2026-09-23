from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionKind,
    SessionInteractionStatus,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService


class _RecordingPublisher:
    def __init__(self, journal):
        self.journal = journal
        self.calls = []

    async def interaction(self, *, project_id, session_id, status, interactions=None):
        self.journal.append("publish")
        self.calls.append((project_id, session_id, status))
        self.pushed = interactions


class _RecordingRecordsService:
    def __init__(self, journal):
        self.journal = journal
        self.events = []

    async def append_many(self, *, events):
        self.journal.append("records")
        self.events.extend(events)
        return []


class _FailingRecordsService:
    async def append_many(self, *, events):
        raise RuntimeError("records unavailable")


def _interaction(*, project_id, token, turn_id="turn-1"):
    return SessionInteraction(
        id=uuid4(),
        project_id=project_id,
        session_id="sess-1",
        turn_id=turn_id,
        token=token,
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.cancelled,
    )


@pytest.mark.asyncio
async def test_stop_cancel_writes_one_record_per_cancelled_interaction_before_publish():
    project_id = uuid4()
    command_id = uuid4()
    cancelled = [
        _interaction(project_id=project_id, token="gate-1"),
        _interaction(project_id=project_id, token="gate-2"),
    ]
    dao = AsyncMock()
    dao.cancel_session_pending = AsyncMock(return_value=cancelled)
    journal = []
    records = _RecordingRecordsService(journal)
    publisher = _RecordingPublisher(journal)
    service = SessionInteractionsService(
        interactions_dao=dao,
        records_service=records,
        watch_publisher=publisher,
    )

    count = await service.cancel_session_pending(
        project_id=project_id,
        session_id="sess-1",
        only_turn_id="turn-1",
        command_id=command_id,
    )

    assert count == 2
    assert len(records.events) == 2
    assert len({event.record_id for event in records.events}) == 2
    for event, interaction in zip(records.events, cancelled):
        assert event.record_type == "interaction_response"
        assert event.record_source == "agent"
        assert event.turn_id == "turn-1"
        assert event.attributes == {
            "type": "interaction_response",
            "id": interaction.token,
            "kind": "user_approval",
            "payload": {
                "outcome": "cancelled",
                "turnId": "turn-1",
                "commandId": str(command_id),
            },
        }
    assert journal == ["records", "publish"]
    assert publisher.calls == [(str(project_id), "sess-1", "resolved")]


@pytest.mark.asyncio
async def test_stop_cancel_writes_no_record_when_nothing_was_pending():
    project_id = uuid4()
    dao = AsyncMock()
    dao.cancel_session_pending = AsyncMock(return_value=[])
    journal = []
    records = _RecordingRecordsService(journal)
    publisher = _RecordingPublisher(journal)
    service = SessionInteractionsService(
        interactions_dao=dao,
        records_service=records,
        watch_publisher=publisher,
    )

    count = await service.cancel_session_pending(
        project_id=project_id,
        session_id="sess-1",
        only_turn_id="turn-1",
        command_id=uuid4(),
    )

    assert count == 0
    assert records.events == []
    assert publisher.calls == []
    assert journal == []


@pytest.mark.asyncio
async def test_record_failure_does_not_block_interaction_resolution_publish():
    project_id = uuid4()
    dao = AsyncMock()
    dao.cancel_session_pending = AsyncMock(
        return_value=[_interaction(project_id=project_id, token="gate-1")]
    )
    journal = []
    publisher = _RecordingPublisher(journal)
    service = SessionInteractionsService(
        interactions_dao=dao,
        records_service=_FailingRecordsService(),
        watch_publisher=publisher,
    )

    count = await service.cancel_session_pending(
        project_id=project_id,
        session_id="sess-1",
        only_turn_id="turn-1",
        command_id=uuid4(),
    )

    assert count == 1
    assert journal == ["publish"]
    assert publisher.calls == [(str(project_id), "sess-1", "resolved")]
