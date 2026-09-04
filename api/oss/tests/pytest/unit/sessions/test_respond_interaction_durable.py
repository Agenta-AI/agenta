import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.models import SessionInteractionRespondRequest
from oss.src.apis.fastapi.sessions.router import InteractionsRouter
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
from oss.src.core.sessions.commands.dtos import SessionCommandState
from oss.src.core.sessions.commands.types import IdempotencyKeyReused
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionKind,
    SessionInteractionStatus,
)
from oss.src.utils.env import env


async def test_durable_response_returns_202_and_stable_refs(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()
    command_id = uuid4()
    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="turn-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.responded,
    )
    admission = SimpleNamespace(
        interaction=interaction,
        command=SimpleNamespace(id=command_id, state=SessionCommandState.pending),
        execution_id="turn-2",
        execution_state=SessionExecutionState.pending_delivery,
    )
    commands = SimpleNamespace(respond_interaction=AsyncMock(return_value=admission))
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=project_id, user_id=user_id),
        headers={"Idempotency-Key": "answer-1"},
    )
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        commands_service=commands,
    )

    response = await router.respond_interaction(
        request=request,
        interaction_id=interaction_id,
        body=SessionInteractionRespondRequest(
            answer={"approved": True}, expected_execution_id="turn-1"
        ),
    )

    assert response.status_code == 202
    assert json.loads(response.body) == {
        "interaction": interaction.model_dump(mode="json"),
        "command": {"id": str(command_id), "state": "pending"},
        "execution": {"id": "turn-2", "state": "pending_delivery"},
    }
    commands.respond_interaction.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="turn-1",
        idempotency_key="answer-1",
    )


async def test_durable_batch_returns_202_with_one_continuation(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    first_id = uuid4()
    second_id = uuid4()
    interaction = SessionInteraction(
        id=first_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="turn-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.responded,
    )
    admission = SimpleNamespace(
        interaction=interaction,
        command=SimpleNamespace(id=uuid4(), state=SessionCommandState.pending),
        execution_id="turn-2",
        execution_state=SessionExecutionState.pending_delivery,
        waiting_for_interactions=False,
    )
    commands = SimpleNamespace(respond_interactions=AsyncMock(return_value=admission))
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        commands_service=commands,
    )

    response = await router.respond_interaction(
        request=SimpleNamespace(
            state=SimpleNamespace(project_id=project_id, user_id=user_id),
            headers={"Idempotency-Key": "approve-all"},
        ),
        interaction_id=first_id,
        body=SessionInteractionRespondRequest(
            answers=[
                {"interaction_id": first_id, "answer": {"approved": True}},
                {"interaction_id": second_id, "answer": {"approved": True}},
            ],
            expected_execution_id="turn-1",
        ),
    )

    assert response.status_code == 202
    commands.respond_interactions.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        interaction_answers=[
            (first_id, {"approved": True}),
            (second_id, {"approved": True}),
        ],
        expected_execution_id="turn-1",
        idempotency_key="approve-all",
    )


async def test_durable_response_returns_the_conflict_envelope(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()
    commands = SimpleNamespace(
        respond_interaction=AsyncMock(side_effect=IdempotencyKeyReused())
    )
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=project_id, user_id=user_id),
        headers={"Idempotency-Key": "answer-1"},
    )
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        commands_service=commands,
    )

    response = await router.respond_interaction(
        request=request,
        interaction_id=interaction_id,
        body=SessionInteractionRespondRequest(answer={"approved": False}),
    )

    assert response.status_code == 409
    assert json.loads(response.body) == {
        "code": "idempotency_key_reused",
        "message": "This idempotency key was already used for a different response.",
        "retryable": False,
    }


async def test_durable_validation_error_returns_422(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    commands = SimpleNamespace(
        respond_interaction=AsyncMock(
            side_effect=router_module.InteractionResponseConflict(
                code="validation_error",
                message="The interaction is not linked to an execution.",
            )
        )
    )
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        commands_service=commands,
    )

    response = await router.respond_interaction(
        request=SimpleNamespace(
            state=SimpleNamespace(project_id=project_id, user_id=user_id),
            headers={"Idempotency-Key": "answer-1"},
        ),
        interaction_id=uuid4(),
        body=SessionInteractionRespondRequest(answer={"approved": True}),
    )

    assert response.status_code == 422
    assert json.loads(response.body)["code"] == "validation_error"


async def test_durable_response_rejects_an_overlength_idempotency_key(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    commands = SimpleNamespace(respond_interaction=AsyncMock())
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = InteractionsRouter(
        interactions_service=AsyncMock(),
        workflows_service=AsyncMock(),
        commands_service=commands,
    )

    response = await router.respond_interaction(
        request=SimpleNamespace(
            state=SimpleNamespace(project_id=project_id, user_id=user_id),
            headers={"Idempotency-Key": "x" * 256},
        ),
        interaction_id=uuid4(),
        body=SessionInteractionRespondRequest(answer={"approved": True}),
    )

    assert response.status_code == 422
    assert json.loads(response.body) == {
        "code": "validation_error",
        "message": "Idempotency-Key is too long.",
        "retryable": False,
        "details": {"field": "Idempotency-Key", "reason": "too_long"},
        "next_step": "Use an Idempotency-Key of at most 255 characters.",
    }
    commands.respond_interaction.assert_not_awaited()


async def test_continuation_resume_endpoint_is_feature_gated(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    commands = SimpleNamespace(
        resume_recoverable_continuation=AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = SessionControlRouter(commands_service=commands)
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=project_id, user_id=user_id)
    )

    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", False)
    disabled = await router.resume_session_continuation(
        request=request, session_id="session-1"
    )
    assert disabled.resumed is False
    commands.resume_recoverable_continuation.assert_not_awaited()

    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    enabled = await router.resume_session_continuation(
        request=request, session_id="session-1"
    )
    assert enabled.resumed is True
    commands.resume_recoverable_continuation.assert_awaited_once_with(
        project_id=project_id, session_id="session-1"
    )


async def test_feature_off_batch_without_path_anchor_returns_422(monkeypatch):
    project_id = uuid4()
    anchor_id = uuid4()
    other_id = uuid4()
    interactions = SimpleNamespace(fetch_interaction=AsyncMock())
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", False)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = InteractionsRouter(
        interactions_service=interactions,
        workflows_service=AsyncMock(),
        commands_service=AsyncMock(),
    )

    response = await router.respond_interaction(
        request=SimpleNamespace(
            state=SimpleNamespace(project_id=project_id, user_id=uuid4()), headers={}
        ),
        interaction_id=anchor_id,
        body=SessionInteractionRespondRequest(
            answers=[{"interaction_id": other_id, "answer": {"approved": True}}]
        ),
    )

    assert response.status_code == 422
    assert json.loads(response.body)["details"] == {
        "field": "answers",
        "reason": "anchor_missing",
    }
    interactions.fetch_interaction.assert_not_awaited()
