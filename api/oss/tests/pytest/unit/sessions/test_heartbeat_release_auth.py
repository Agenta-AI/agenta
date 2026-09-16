from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException

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


@pytest.mark.asyncio
async def test_release_owner_heartbeat_requires_the_runner_token(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "runner-secret")
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    service = SimpleNamespace(heartbeat=AsyncMock())

    with pytest.raises(HTTPException) as exc_info:
        await _router(service).heartbeat_session_stream(
            _request(),
            SessionHeartbeatRequest(
                session_id="session-1",
                replica_id="replica-1",
                release_owner=True,
            ),
        )

    assert exc_info.value.status_code == 401
    service.heartbeat.assert_not_awaited()


@pytest.mark.asyncio
async def test_regular_heartbeat_keeps_user_authentication_only(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "runner-secret")
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    service = SimpleNamespace(
        heartbeat=AsyncMock(return_value=SessionHeartbeatResult(replica_id="replica-1"))
    )
    payload = SessionHeartbeatRequest(
        session_id="session-1",
        replica_id="replica-1",
        turn_id="turn-1",
    )

    result = await _router(service).heartbeat_session_stream(_request(), payload)

    assert result.replica_id == "replica-1"
    service.heartbeat.assert_awaited_once_with(project_id=_PROJECT, request=payload)


@pytest.mark.asyncio
async def test_release_owner_accepts_the_shared_runner_token(monkeypatch):
    monkeypatch.setattr(env.runner, "token", "runner-secret")
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    service = SimpleNamespace(
        heartbeat=AsyncMock(return_value=SessionHeartbeatResult(replica_id="replica-1"))
    )
    payload = SessionHeartbeatRequest(
        session_id="session-1",
        replica_id="replica-1",
        release_owner=True,
    )

    await _router(service).heartbeat_session_stream(
        _request({"X-Agenta-Runner-Token": "runner-secret"}), payload
    )

    service.heartbeat.assert_awaited_once_with(project_id=_PROJECT, request=payload)
