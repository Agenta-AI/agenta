"""SessionTurnsRouter — POST /sessions/turns/latest.

The resume read must go through `latest_turn`/`latest_turn_per_harness_kind` (ordered by
`turn_index`, so a late/out-of-order write can't win), NOT the id-ordered `query_turns` +
windowing. Pins the RBAC gate and that the handler routes by `harness_kind` presence.
"""

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.router import SessionTurnsRouter
from oss.src.apis.fastapi.sessions.models import SessionTurnLatestRequest
from oss.src.core.sessions.turns.dtos import HarnessKind


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/turns/latest",
            "headers": [],
            "app": app,
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool):
    return patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


@pytest.mark.asyncio
async def test_latest_without_harness_uses_latest_turn():
    turns_service = AsyncMock()
    turns_service.latest_turn.return_value = None
    router = SessionTurnsRouter(turns_service=turns_service)

    request = _make_authed_request(FastAPI(), uuid4(), uuid4())
    body = SessionTurnLatestRequest(session_id="sess-1")

    with _patched_access(True):
        result = await router.latest_turn(request=request, body=body)

    assert result.count == 0
    turns_service.latest_turn.assert_awaited_once()
    turns_service.latest_turn_per_harness_kind.assert_not_awaited()


@pytest.mark.asyncio
async def test_latest_with_harness_uses_per_harness_kind():
    turns_service = AsyncMock()
    turns_service.latest_turn_per_harness_kind.return_value = None
    router = SessionTurnsRouter(turns_service=turns_service)

    request = _make_authed_request(FastAPI(), uuid4(), uuid4())
    body = SessionTurnLatestRequest(
        session_id="sess-1", harness_kind=HarnessKind.CLAUDE
    )

    with _patched_access(True):
        result = await router.latest_turn(request=request, body=body)

    assert result.count == 0
    turns_service.latest_turn_per_harness_kind.assert_awaited_once()
    assert (
        turns_service.latest_turn_per_harness_kind.await_args.kwargs["harness_kind"]
        == HarnessKind.CLAUDE
    )
    turns_service.latest_turn.assert_not_awaited()


@pytest.mark.asyncio
async def test_latest_rejects_without_permission():
    turns_service = AsyncMock()
    router = SessionTurnsRouter(turns_service=turns_service)

    request = _make_authed_request(FastAPI(), uuid4(), uuid4())
    body = SessionTurnLatestRequest(session_id="sess-1")

    with _patched_access(False):
        with pytest.raises(HTTPException):
            await router.latest_turn(request=request, body=body)

    turns_service.latest_turn.assert_not_awaited()
