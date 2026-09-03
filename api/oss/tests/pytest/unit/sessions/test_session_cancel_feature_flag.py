import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
from oss.src.core.sessions.commands.dtos import SessionCommandState
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
        request_cancel_legacy=AsyncMock(),
        request_cancel=AsyncMock(),
    )

    response = await SessionControlRouter(
        commands_service=service
    ).cancel_session_execution(_request(), "session-1")

    service.request_cancel_legacy.assert_awaited_once_with(
        project_id=_PROJECT,
        user_id=_USER,
        session_id="session-1",
    )
    service.request_cancel.assert_not_awaited()
    assert response.status_code == 200
    assert json.loads(response.body) == {
        "command": None,
        "execution": {"id": None, "state": "idle"},
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
