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
from oss.src.utils.env import _parse_sessions_late_output
from oss.src.utils.env import _parse_sessions_watchdog_stale_heartbeat_seconds


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_USER = UUID("00000000-0000-0000-0000-0000000000bb")


def test_unknown_late_output_policy_falls_back_to_quarantine(monkeypatch):
    monkeypatch.setenv("AGENTA_SESSIONS_LATE_OUTPUT", "typo")

    with pytest.warns(UserWarning, match="behaving as 'quarantine'"):
        value = _parse_sessions_late_output()

    assert value == "quarantine"


@pytest.mark.parametrize(
    ("durable_stop", "expected"),
    [(None, 90), ("", 90), ("false", 300), ("true", 90)],
)
def test_watchdog_default_respects_durable_stop_setting(
    monkeypatch, durable_stop, expected
):
    if durable_stop is None:
        monkeypatch.delenv("AGENTA_SESSIONS_DURABLE_STOP", raising=False)
    else:
        monkeypatch.setenv("AGENTA_SESSIONS_DURABLE_STOP", durable_stop)
    monkeypatch.delenv(
        "AGENTA_SESSIONS_WATCHDOG_STALE_HEARTBEAT_SECONDS", raising=False
    )

    assert _parse_sessions_watchdog_stale_heartbeat_seconds() == expected


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


async def test_cancel_rejects_an_overlength_idempotency_key(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    service = SimpleNamespace(request_cancel=AsyncMock())
    request = _request()
    request.headers = {"Idempotency-Key": "x" * 256}

    response = await SessionControlRouter(
        commands_service=service
    ).cancel_session_execution(request, "session-1")

    assert response.status_code == 422
    assert json.loads(response.body) == {
        "code": "validation_error",
        "message": "Idempotency-Key is too long.",
        "retryable": False,
        "details": {"field": "Idempotency-Key", "reason": "too_long"},
        "next_step": "Use an Idempotency-Key of at most 255 characters.",
    }
    service.request_cancel.assert_not_awaited()
