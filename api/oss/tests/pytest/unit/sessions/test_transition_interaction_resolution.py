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


# Walk-away needs the sweep, so it is pinned by the acceptance test and the I1 gate cell, not here.
@pytest.mark.parametrize(
    ("kind", "outcome", "target_status", "resolution"),
    [
        (
            SessionInteractionKind.user_approval,
            "complete",
            SessionInteractionStatus.resolved,
            {"verdict": "approved", "tool_call_id": "tool-1"},
        ),
        (
            SessionInteractionKind.user_approval,
            "decline",
            SessionInteractionStatus.resolved,
            {"verdict": "denied", "tool_call_id": "tool-1"},
        ),
        (
            SessionInteractionKind.user_input,
            "complete",
            SessionInteractionStatus.responded,
            {
                "tool_call_id": "tool-1",
                "tool_name": "request_input",
                "outcome": "completed",
                "output": {"action": "accept", "content": {"timezone": "UTC"}},
            },
        ),
        (
            SessionInteractionKind.user_input,
            "decline",
            SessionInteractionStatus.responded,
            {
                "tool_call_id": "tool-1",
                "tool_name": "request_input",
                "outcome": "completed",
                "output": {"action": "decline"},
            },
        ),
        (
            SessionInteractionKind.client_tool,
            "complete",
            SessionInteractionStatus.responded,
            {
                "tool_call_id": "tool-1",
                "tool_name": "request_connection",
                "outcome": "completed",
                "output": {"connected": True, "integration": "telegram"},
            },
        ),
        (
            SessionInteractionKind.client_tool,
            "decline",
            SessionInteractionStatus.responded,
            {
                "tool_call_id": "tool-1",
                "tool_name": "request_connection",
                "outcome": "completed",
                "output": {"connected": False, "reason": "declined"},
            },
        ),
    ],
)
async def test_transition_route_settlement_matrix(
    kind, outcome, target_status, resolution
):
    project_id = uuid4()
    user_id = uuid4()
    captured = []
    source = SessionInteraction(
        project_id=project_id,
        session_id="session-1",
        token=f"{kind.value}-{outcome}",
        kind=kind,
        status=SessionInteractionStatus.pending,
    )

    class _InteractionsService:
        async def query_interactions(self, *, project_id, query):
            return [source]

        async def transition_interaction(self, *, transition):
            captured.append(transition)
            return SessionInteraction(
                project_id=transition.project_id,
                session_id=transition.session_id,
                token=transition.token,
                kind=kind,
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
        token=source.token,
        status=target_status,
        resolution=resolution,
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
    assert captured[0].status == target_status
    assert captured[0].resolution == resolution
    assert response.interaction is not None
    assert response.interaction.status == target_status
    assert response.interaction.data is not None
    assert response.interaction.data.resolution == resolution


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
    interactions_service = AsyncMock()
    interactions_service.query_interactions.return_value = [
        SessionInteraction(
            project_id=uuid4(),
            session_id="session-1",
            token="approval-token",
            kind=SessionInteractionKind.user_approval,
            status=SessionInteractionStatus.pending,
        )
    ]
    router = InteractionsRouter(
        interactions_service=interactions_service,
        workflows_service=AsyncMock(),
        respond_task=AsyncMock(),
    )
    app = FastAPI()
    app.include_router(router.router)

    @app.middleware("http")
    async def add_request_scope(request, call_next):
        request.state.project_id = uuid4()
        request.state.user_id = uuid4()
        return await call_next(request)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = TestClient(app).post("/transition", json=payload)

    assert response.status_code == 422


async def test_transition_route_accepts_open_resolution_for_client_tool_on_responded():
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
    interactions_service.transition_interaction.return_value = SessionInteraction(
        project_id=project_id,
        session_id="session-1",
        token="client-tool-token",
        kind=SessionInteractionKind.client_tool,
        status=SessionInteractionStatus.responded,
    )
    router = InteractionsRouter(
        interactions_service=interactions_service,
        workflows_service=AsyncMock(),
        respond_task=AsyncMock(),
    )
    body = SessionInteractionTransitionRequest(
        session_id="session-1",
        token="client-tool-token",
        status=SessionInteractionStatus.responded,
        resolution={
            "tool_call_id": "tool-1",
            "tool_name": "request_connection",
            "outcome": "completed",
            "output": {"connected": True},
        },
    )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        await router.transition_interaction(
            request=_make_authed_request(FastAPI(), project_id, user_id),
            body=body,
        )

    transition = interactions_service.transition_interaction.await_args.kwargs[
        "transition"
    ]
    assert transition.status == SessionInteractionStatus.responded
    assert transition.resolution == body.resolution


async def test_transition_route_rejects_resolved_client_tool_with_409():
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
        resolution={"tool_call_id": "tool-1", "outcome": "completed"},
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
