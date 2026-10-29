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


async def test_append_turn_is_refused_without_run_sessions(monkeypatch):
    from oss.src.apis.fastapi.sessions.models import SessionTurnAppendRequest
    from oss.src.apis.fastapi.sessions.router import SessionTurnsRouter

    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(
        router_module, "allow_session_write", AsyncMock(return_value=True)
    )
    turns = AsyncMock()
    router = SessionTurnsRouter(turns_service=turns)

    with pytest.raises(HTTPException) as refused:
        await router.append_turn(
            request=_request(),
            body=SessionTurnAppendRequest(
                session_id="s", stream_id=uuid4(), turn_index=0, harness_kind="mock"
            ),
        )
    assert refused.value.status_code == 403
    assert turns.mock_calls == []


async def test_a_create_race_recheck_reads_the_session_again(monkeypatch):
    """`SessionRecheck` drops what the request read for the session before it checks the
    row that appeared, so it never decides from a value read before the row existed."""
    from oss.src.apis.fastapi.sharing import utils as sharing_utils

    forgotten = []
    monkeypatch.setattr(sharing_utils, "forget_prefetch", forgotten.append)
    monkeypatch.setattr(sharing_utils, "allow_resource", AsyncMock(return_value=True))
    request = _request()
    recheck = sharing_utils.session_recheck(
        request, action=router_module.Permission.RUN_SESSIONS, session_id="s-race"
    )
    await recheck()
    assert [entry["key"] for entry in forgotten] == [{"s": "s-race"}]
    assert recheck.checked is True
