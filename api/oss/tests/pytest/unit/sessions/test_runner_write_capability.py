"""The runner write routes keep their capability check ahead of the admission-record
shortcut (Codex fix review, item 3): a role that lost RUN_SESSIONS is refused with 403
even when its turn's admission record would let the write through."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.models import (
    SessionInteractionCancelStaleRequest,
    SessionInteractionCreateRequest,
    SessionInteractionTransitionRequest,
)
from oss.src.apis.fastapi.sessions.router import InteractionsRouter


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4()))
    )


@pytest.mark.parametrize(
    "call",
    [
        lambda r, req: r.create_interaction(
            request=req,
            body=SessionInteractionCreateRequest(
                session_id="s", turn_id="t", token="tok", kind="user_approval"
            ),
        ),
        lambda r, req: r.transition_interaction(
            request=req,
            body=SessionInteractionTransitionRequest(
                session_id="s", token="tok", status="resolved"
            ),
        ),
        lambda r, req: r.cancel_stale_interactions(
            request=req,
            body=SessionInteractionCancelStaleRequest(session_id="s", turn_id="t"),
        ),
    ],
)
async def test_a_role_without_run_sessions_is_refused_despite_continuity(
    monkeypatch, call
):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=False)
    )
    # The admission record would let the write through.
    monkeypatch.setattr(
        router_module, "allow_session_write", AsyncMock(return_value=True)
    )
    interactions = AsyncMock()
    router = InteractionsRouter(
        interactions_service=interactions, commands_service=AsyncMock()
    )

    with pytest.raises(HTTPException) as refused:
        await call(router, _request())

    assert refused.value.status_code == 403
    assert interactions.mock_calls == []
