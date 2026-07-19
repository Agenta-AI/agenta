from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.models import SessionInteractionTransitionRequest
from oss.src.apis.fastapi.sessions.router import InteractionsRouter
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionData,
    SessionInteractionKind,
    SessionInteractionStatus,
)


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/interactions/transition",
            "headers": [],
            "app": app,
        }
    )
    request.state.project_id = project_id
    request.state.user_id = user_id
    return request


async def test_transition_route_passes_resolution_to_the_domain_transition():
    project_id = uuid4()
    user_id = uuid4()
    captured = []

    class _InteractionsService:
        async def transition_interaction(self, *, transition):
            captured.append(transition)
            return SessionInteraction(
                project_id=transition.project_id,
                session_id=transition.session_id,
                token=transition.token,
                kind=SessionInteractionKind.user_approval,
                status=transition.status,
                data=SessionInteractionData(resolution=transition.resolution),
            )

    router = InteractionsRouter(
        interactions_service=_InteractionsService(),
        workflows_service=AsyncMock(),
        respond_task=AsyncMock(),
    )
    body = SessionInteractionTransitionRequest(
        session_id="session-1",
        token="approval-token",
        status=SessionInteractionStatus.resolved,
        resolution={"verdict": "denied", "tool_call_id": "tool-1"},
    )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = await router.transition_interaction(
            request=_make_authed_request(FastAPI(), project_id, user_id),
            body=body,
        )

    assert len(captured) == 1
    assert captured[0].resolution == {
        "verdict": "denied",
        "tool_call_id": "tool-1",
    }
    assert response.interaction is not None
    assert response.interaction.data is not None
    assert response.interaction.data.resolution == captured[0].resolution
