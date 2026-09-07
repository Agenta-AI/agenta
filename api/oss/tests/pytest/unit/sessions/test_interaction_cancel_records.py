from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.models import SessionInteractionRespondRequest
from oss.src.apis.fastapi.sessions.router import InteractionsRouter
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

    async def interaction(self, *, project_id, session_id, status):
        self.journal.append("publish")
        self.calls.append((project_id, session_id, status))


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


@pytest.mark.asyncio
async def test_answer_after_stop_returns_the_terminal_interaction_409_contract():
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()
    interactions_service = AsyncMock()
    interactions_service.fetch_interaction.return_value = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="sess-1",
        turn_id="turn-1",
        token="gate-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.cancelled,
    )
    respond_task = AsyncMock()
    respond_task.kiq = AsyncMock()
    router = InteractionsRouter(
        interactions_service=interactions_service,
        workflows_service=AsyncMock(),
        respond_task=respond_task,
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": f"/sessions/interactions/{interaction_id}/respond",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = project_id
    request.state.user_id = user_id

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.respond_interaction(
                request=request,
                interaction_id=interaction_id,
                body=SessionInteractionRespondRequest(answer={"approved": True}),
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Interaction is no longer pending"
    interactions_service.transition_interaction.assert_not_awaited()
    respond_task.kiq.assert_not_awaited()
