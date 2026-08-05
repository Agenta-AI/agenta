from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.models import SessionTurnCompleteRequest
from oss.src.apis.fastapi.sessions.router import SessionTurnsRouter
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurn
from oss.src.core.sessions.turns.types import SessionTurnNotFound


def _request(project_id, user_id) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/turns/complete",
        "headers": [],
        "app": FastAPI(),
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _access(allowed: bool):
    return patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


async def test_complete_turn_delegates_project_scoped_key_and_completion_fields():
    project_id = uuid4()
    user_id = uuid4()
    stream_id = uuid4()
    ended_at = datetime.now(timezone.utc)
    completed = SessionTurn(
        id=uuid4(),
        project_id=project_id,
        session_id="session-1",
        stream_id=stream_id,
        turn_index=4,
        harness_kind=HarnessKind.CLAUDE,
        agent_session_id="agent-1",
        end_time=ended_at,
    )
    service = AsyncMock()
    service.complete_turn.return_value = completed
    router = SessionTurnsRouter(turns_service=service)

    with _access(True):
        response = await router.complete_turn(
            request=_request(project_id, user_id),
            body=SessionTurnCompleteRequest(
                session_id="session-1",
                turn_index=4,
                agent_session_id="agent-1",
                end_time=ended_at,
            ),
        )

    assert response.count == 1
    assert response.turn == completed
    call = service.complete_turn.await_args.kwargs
    assert call["project_id"] == str(project_id)
    assert call["turn"].session_id == "session-1"
    assert call["turn"].turn_index == 4
    assert call["turn"].agent_session_id == "agent-1"
    assert call["turn"].end_time == ended_at


async def test_complete_turn_refuses_unknown_row_with_404():
    project_id = uuid4()
    user_id = uuid4()
    service = AsyncMock()
    service.complete_turn.side_effect = SessionTurnNotFound("missing-session", 7)
    router = SessionTurnsRouter(turns_service=service)

    with _access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.complete_turn(
                request=_request(project_id, user_id),
                body=SessionTurnCompleteRequest(
                    session_id="missing-session",
                    turn_index=7,
                    end_time=datetime.now(timezone.utc),
                ),
            )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "No turn 7 found for session 'missing-session'."


async def test_complete_turn_rejects_without_run_permission():
    project_id = uuid4()
    user_id = uuid4()
    service = AsyncMock()
    router = SessionTurnsRouter(turns_service=service)

    with _access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.complete_turn(
                request=_request(project_id, user_id),
                body=SessionTurnCompleteRequest(
                    session_id="session-1",
                    turn_index=0,
                    end_time=datetime.now(timezone.utc),
                ),
            )

    assert exc_info.value.status_code == 403
    service.complete_turn.assert_not_awaited()
