from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
import pytest

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
        async def query_interactions(self, *, project_id, query):
            return [
                SessionInteraction(
                    project_id=project_id,
                    session_id=query.session_id,
                    token="approval-token",
                    kind=SessionInteractionKind.user_approval,
                    status=SessionInteractionStatus.pending,
                )
            ]

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


@pytest.mark.parametrize(
    "payload",
    [
        {
            "session_id": "session-1",
            "token": "approval-token",
            "status": "pending",
            "resolution": {"verdict": "approved", "tool_call_id": "tool-1"},
        },
        {
            "session_id": "session-1",
            "token": "approval-token",
            "status": "resolved",
            "resolution": {"verdict": "maybe", "tool_call_id": "tool-1"},
        },
        {
            "session_id": "session-1",
            "token": "approval-token",
            "status": "resolved",
            "resolution": {"verdict": "approved"},
        },
    ],
)
def test_transition_route_rejects_invalid_approval_resolution_with_422(payload):
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        respond_task=AsyncMock(),
    )
    app = FastAPI()
    app.include_router(router.router)

    response = TestClient(app).post("/transition", json=payload)

    assert response.status_code == 422


async def test_transition_route_rejects_resolution_for_client_tool_with_409():
    project_id = uuid4()
    user_id = uuid4()
    interactions_service = AsyncMock()
    interactions_service.query_interactions.return_value = [
        SessionInteraction(
            project_id=project_id,
            session_id="session-1",
            token="client-tool-token",
            kind=SessionInteractionKind.client_tool,
            status=SessionInteractionStatus.pending,
        )
    ]
    router = InteractionsRouter(
        interactions_service=interactions_service,
        workflows_service=AsyncMock(),
        respond_task=AsyncMock(),
    )
    body = SessionInteractionTransitionRequest(
        session_id="session-1",
        token="client-tool-token",
        status=SessionInteractionStatus.resolved,
        resolution={"verdict": "approved", "tool_call_id": "tool-1"},
    )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as caught:
            await router.transition_interaction(
                request=_make_authed_request(FastAPI(), project_id, user_id),
                body=body,
            )

    assert caught.value.status_code == 409
    interactions_service.transition_interaction.assert_not_awaited()
