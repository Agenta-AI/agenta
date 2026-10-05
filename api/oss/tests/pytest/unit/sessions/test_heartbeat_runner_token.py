"""The heartbeat route reads the runner token as optional.

A beat is authorized by the invoke caller's project credential, as before. The runner token on
top of it proves the caller is runner infrastructure, which is what makes its pod address safe
to send the runner token to on a later Stop. A missing or wrong token is not a refusal: the beat
still runs, and the service binds the turn without an address.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionHeartbeatResult,
)
from oss.src.utils.env import env


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_USER = UUID("00000000-0000-0000-0000-0000000000bb")


def _request(headers=None):
    return SimpleNamespace(
        state=SimpleNamespace(project_id=_PROJECT, user_id=_USER),
        headers=headers or {},
    )


def _router(service):
    return SessionStreamsRouter(
        service=service,
        interactions_service=SimpleNamespace(),
    )


def _payload() -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id="session-1",
        replica_id="replica-1",
        replica_address="http://10.0.0.1:8765",
        turn_id="turn-1",
    )


def _service():
    return SimpleNamespace(
        heartbeat=AsyncMock(return_value=SessionHeartbeatResult(replica_id="replica-1"))
    )


@pytest.fixture(autouse=True)
def _allowed(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )


@pytest.mark.asyncio
async def test_a_beat_with_the_runner_token_is_runner_verified(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "runner-secret")
    service = _service()
    payload = _payload()

    await _router(service).heartbeat_session_stream(
        _request({"X-Agenta-Runner-Token": "runner-secret"}), payload
    )

    service.heartbeat.assert_awaited_once_with(
        project_id=_PROJECT, request=payload, runner_verified=True
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [{}, {"X-Agenta-Runner-Token": "wrong-secret"}],
    ids=["no-token", "wrong-token"],
)
async def test_a_beat_without_a_valid_runner_token_still_runs_unverified(
    monkeypatch, headers
):
    monkeypatch.setattr(env.runner, "token", "runner-secret")
    service = _service()
    payload = _payload()

    result = await _router(service).heartbeat_session_stream(_request(headers), payload)

    assert result.replica_id == "replica-1"
    service.heartbeat.assert_awaited_once_with(
        project_id=_PROJECT, request=payload, runner_verified=False
    )


@pytest.mark.asyncio
async def test_a_deployment_with_no_runner_token_verifies_no_beat(monkeypatch):
    monkeypatch.setattr(env.runner, "token", None)
    service = _service()
    payload = _payload()

    await _router(service).heartbeat_session_stream(
        _request({"X-Agenta-Runner-Token": "anything"}), payload
    )

    service.heartbeat.assert_awaited_once_with(
        project_id=_PROJECT, request=payload, runner_verified=False
    )
