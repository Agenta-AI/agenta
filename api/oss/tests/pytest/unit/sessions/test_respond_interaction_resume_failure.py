"""Issue 5592: Answering an approval must not consume it when resume never starts.

The router transitions pending->responded before enqueuing the resume. If the
resume fails (HTTP 500 from workflow service, or dispatch_fn raises), the
approval is gone and the human cannot retry. The fix reverts the row to
pending with an error and surfaces a 502, so retry stays possible.
"""

from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.sessions.router import InteractionsRouter
from oss.src.apis.fastapi.sessions.models import SessionInteractionRespondRequest
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionKind,
    SessionInteractionStatus,
)
from oss.src.core.workflows.types import WorkflowDetachedStartFailed


def _pending_interaction():
    pid = uuid4()
    uid = uuid4()
    iid = uuid4()
    inter = SessionInteraction(
        id=iid,
        project_id=pid,
        session_id="sess-1",
        token="tok-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )
    return pid, uid, iid, inter


class _RespondedThenPendingService:
    """Records transitions so we can assert revert happened."""

    def __init__(self, interaction):
        self._interaction = interaction
        self.transitions = []
        self._first = True

    async def fetch_interaction(self, *, project_id, interaction_id):
        return self._interaction

    async def transition_interaction(self, *, transition):
        self.transitions.append(transition.status)
        if self._first:
            self._first = False
            # pending -> responded succeeds
            inter = self._interaction.model_copy(
                update={"status": SessionInteractionStatus.responded}
            )
            self._interaction = inter
            return inter
        # second call is the revert: responded -> pending
        inter = self._interaction.model_copy(
            update={"status": SessionInteractionStatus.pending}
        )
        self._interaction = inter
        return inter


def _make_request(pid, uid):
    from fastapi import FastAPI, Request

    app = FastAPI()
    scope = {"type": "http", "method": "POST", "path": "/x", "headers": [], "app": app}
    req = Request(scope)
    req.state.project_id = str(pid)
    req.state.user_id = str(uid)
    return req


async def test_inline_invoke_failure_reverts_to_pending_and_raises_502():
    pid, uid, iid, inter = _pending_interaction()
    service = _RespondedThenPendingService(inter)
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(
        side_effect=WorkflowDetachedStartFailed(
            "Workflow service returned HTTP 500 on detached start: b''"
        )
    )

    router = InteractionsRouter(
        interactions_service=service,
        workflows_service=workflows,
        respond_task=None,
        interactions_dispatcher=None,
    )
    req = _make_request(pid, uid)
    body = SessionInteractionRespondRequest(answer={"approved": True})

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc:
            await router.respond_interaction(request=req, interaction_id=iid, body=body)

    assert exc.value.status_code == 502
    assert "Resume failed to start" in str(exc.value.detail)
    # two transitions: pending->responded then responded->pending (revert)
    assert service.transitions == [
        SessionInteractionStatus.responded,
        SessionInteractionStatus.pending,
    ]


async def test_dispatcher_failure_reverts_to_pending_and_raises_502():
    pid, uid, iid, inter = _pending_interaction()
    service = _RespondedThenPendingService(inter)
    dispatcher = MagicMock()
    dispatcher.respond = AsyncMock(
        side_effect=WorkflowDetachedStartFailed(
            "Workflow service returned HTTP 500 on detached start"
        )
    )

    router = InteractionsRouter(
        interactions_service=service,
        workflows_service=MagicMock(),
        respond_task=None,
        interactions_dispatcher=dispatcher,
    )
    req = _make_request(pid, uid)
    body = SessionInteractionRespondRequest(answer={"approved": True})

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc:
            await router.respond_interaction(request=req, interaction_id=iid, body=body)

    assert exc.value.status_code == 502
    assert service.transitions == [
        SessionInteractionStatus.responded,
        SessionInteractionStatus.pending,
    ]


async def test_kiq_enqueue_failure_reverts_to_pending():
    pid, uid, iid, inter = _pending_interaction()
    service = _RespondedThenPendingService(inter)
    task = MagicMock()
    task.kiq = AsyncMock(side_effect=RuntimeError("redis unavailable"))

    router = InteractionsRouter(
        interactions_service=service,
        workflows_service=MagicMock(),
        respond_task=task,
    )
    req = _make_request(pid, uid)
    body = SessionInteractionRespondRequest(answer={"approved": True})

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as exc:
            await router.respond_interaction(request=req, interaction_id=iid, body=body)

    assert exc.value.status_code == 502
    assert service.transitions == [
        SessionInteractionStatus.responded,
        SessionInteractionStatus.pending,
    ]


async def test_success_still_returns_responded():
    pid, uid, iid, inter = _pending_interaction()

    class _SuccessService:
        async def fetch_interaction(self, *, project_id, interaction_id):
            return inter

        async def transition_interaction(self, *, transition):
            assert transition.status == SessionInteractionStatus.responded
            return inter.model_copy(
                update={"status": SessionInteractionStatus.responded}
            )

    task = MagicMock()
    task.kiq = AsyncMock(return_value=None)

    router = InteractionsRouter(
        interactions_service=_SuccessService(),
        workflows_service=MagicMock(),
        respond_task=task,
    )
    req = _make_request(pid, uid)
    body = SessionInteractionRespondRequest(answer={"approved": True})

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        resp = await router.respond_interaction(
            request=req, interaction_id=iid, body=body
        )

    assert resp.interaction.status == SessionInteractionStatus.responded
    task.kiq.assert_awaited_once()
