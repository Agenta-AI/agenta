import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
from oss.src.core.sessions.commands.dtos import SessionCommandState
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


def test_watchdog_default_is_three_missed_heartbeats(monkeypatch):
    monkeypatch.delenv(
        "AGENTA_SESSIONS_WATCHDOG_STALE_HEARTBEAT_SECONDS", raising=False
    )

    assert _parse_sessions_watchdog_stale_heartbeat_seconds() == 90


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=_PROJECT, user_id=_USER),
        headers={},
    )


async def test_cancel_route_admits_a_durable_stop(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    command = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-0000000000cc"),
        state=SessionCommandState.pending,
    )
    service = SimpleNamespace(
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
    assert response.status_code == 202


def test_runner_token_rejects_non_ascii_credentials_as_unauthorized(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "shared-secret")
    request = SimpleNamespace(headers={"X-Agenta-Runner-Token": "nøt-the-token"})

    with pytest.raises(HTTPException) as exc_info:
        router_module._assert_runner_token(request)

    assert exc_info.value.status_code == 401


async def test_cancel_rejects_an_overlength_idempotency_key(monkeypatch):
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
