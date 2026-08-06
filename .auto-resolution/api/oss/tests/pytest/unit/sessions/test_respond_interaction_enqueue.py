"""The workflow enqueue must fire only after a winning CAS transition.

Two concurrent respond calls race the same pending interaction; only one may flip
pending -> responded (the DAO's real UPDATE...WHERE status IN(...) RETURNING). Before the
fix, the enqueue fired before the CAS, so both responders enqueued. This asserts the
enqueue now happens exactly once — for whichever responder wins the transition — and the
loser gets a 409, not a duplicate enqueue.
"""

import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.router import InteractionsRouter
from oss.src.apis.fastapi.sessions.models import SessionInteractionRespondRequest
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionKind,
    SessionInteractionStatus,
)
from oss.src.core.sessions.interactions.types import InteractionNotFound


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/interactions/x/respond",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


class _RacyInteractionsService:
    """Fakes the real CAS: only the first transition_interaction call wins the row."""

    def __init__(self, *, interaction: SessionInteraction):
        self._interaction = interaction
        self._transitioned = False
        self.transition_calls = 0

    async def fetch_interaction(self, *, project_id, interaction_id):
        return self._interaction

    async def transition_interaction(self, *, transition):
        self.transition_calls += 1
        if self._transitioned:
            raise InteractionNotFound("already transitioned")
        self._transitioned = True
        won = self._interaction.model_copy(
            update={"status": SessionInteractionStatus.responded}
        )
        return won


async def test_two_concurrent_responds_enqueue_exactly_once():
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()

    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="sess-1",
        token="tok-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )

    service = _RacyInteractionsService(interaction=interaction)
    respond_task = AsyncMock()
    respond_task.kiq = AsyncMock()

    router = InteractionsRouter(
        interactions_service=service,
        workflows_service=AsyncMock(),
        respond_task=respond_task,
    )

    app = FastAPI()
    body = SessionInteractionRespondRequest(answer={"ok": True})

    async def _respond():
        request = _make_authed_request(app, project_id, user_id)
        return await router.respond_interaction(
            request=request,
            interaction_id=interaction_id,
            body=body,
        )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        results = await asyncio.gather(_respond(), _respond(), return_exceptions=True)

    successes = [r for r in results if not isinstance(r, Exception)]
    failures = [r for r in results if isinstance(r, Exception)]

    assert len(successes) == 1, "exactly one responder should win the CAS"
    assert len(failures) == 1
    assert isinstance(failures[0], HTTPException)
    assert failures[0].status_code == 409

    respond_task.kiq.assert_awaited_once()
    assert service.transition_calls == 2


async def test_losing_responder_never_enqueues_when_cas_loses_first():
    """Transition-before-enqueue: if the CAS never wins, nothing is ever enqueued."""
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()

    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="sess-1",
        token="tok-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )

    class _AlwaysLosesService:
        async def fetch_interaction(self, *, project_id, interaction_id):
            return interaction

        async def transition_interaction(self, *, transition):
            raise InteractionNotFound("already terminal")

    respond_task = AsyncMock()
    respond_task.kiq = AsyncMock()

    router = InteractionsRouter(
        interactions_service=_AlwaysLosesService(),
        workflows_service=AsyncMock(),
        respond_task=respond_task,
    )

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)
    body = SessionInteractionRespondRequest(answer={"ok": True})

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.respond_interaction(
                request=request,
                interaction_id=interaction_id,
                body=body,
            )

    assert exc_info.value.status_code == 409
    respond_task.kiq.assert_not_awaited()
