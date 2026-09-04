import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.models import SessionCancelRequest
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
from oss.src.core.sessions.commands.dtos import SessionCommandState
from oss.src.core.sessions.streams.dtos import CommandMode, SessionStreamCommandResponse
from oss.src.utils.env import env


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_USER = UUID("00000000-0000-0000-0000-0000000000bb")


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=_PROJECT, user_id=_USER),
        headers={},
    )


async def test_cancel_route_uses_legacy_path_when_durable_stop_is_off(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", False)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    service = SimpleNamespace(
        request_cancel_legacy=AsyncMock(
            return_value=SessionStreamCommandResponse(
                mode=CommandMode.cancel,
                session_id="session-1",
                turn_id="turn-1",
                detached=True,
            )
        ),
        request_cancel=AsyncMock(),
    )

    response = await SessionControlRouter(
        commands_service=service
    ).cancel_session_execution(
        _request(),
        "session-1",
        SessionCancelRequest(expected_execution_id="turn-1"),
    )

    service.request_cancel_legacy.assert_awaited_once_with(
        project_id=_PROJECT,
        user_id=_USER,
        session_id="session-1",
        expected_execution_id="turn-1",
    )
    service.request_cancel.assert_not_awaited()
    assert response.status_code == 200
    assert json.loads(response.body) == {
        "mode": "cancel",
        "session_id": "session-1",
        "turn_id": "turn-1",
        "watcher_id": None,
        "detached": True,
        "cancelled_turn_ids": [],
    }


async def test_cancel_route_uses_durable_path_when_flag_is_on(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    command = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-0000000000cc"),
        state=SessionCommandState.pending,
    )
    service = SimpleNamespace(
        request_cancel_legacy=AsyncMock(),
        request_cancel=AsyncMock(
            return_value=SimpleNamespace(
                command=command,
                execution_id="turn-1",
                accepted=True,
            )
        ),
    )

    response = await SessionControlRouter(
        commands_service=service
    ).cancel_session_execution(_request(), "session-1")

    service.request_cancel.assert_awaited_once()
    service.request_cancel_legacy.assert_not_awaited()
    assert response.status_code == 202


def test_runner_token_rejects_non_ascii_credentials_as_unauthorized(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "shared-secret")
    request = SimpleNamespace(headers={"X-Agenta-Runner-Token": "nøt-the-token"})

    with pytest.raises(HTTPException) as exc_info:
        router_module._assert_runner_token(request)

    assert exc_info.value.status_code == 401
