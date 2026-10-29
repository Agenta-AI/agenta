"""Only the runner may write a turn's agent_session_id and sandbox_id."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request

from agenta.sdk.agents.dtos import HarnessKind
from oss.src.apis.fastapi.sessions.models import (
    SessionTurnAppendRequest,
    SessionTurnCompleteRequest,
)
from oss.src.apis.fastapi.sessions.router import SessionTurnsRouter
from oss.src.apis.fastapi.shared import runner_auth
from oss.src.core.sessions.turns.dtos import SessionTurn


RUNNER_TOKEN = "runner-token-for-tests"
PROJECT_ID = uuid4()


def _request(headers=None) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/turns/",
        "headers": [
            (key.lower().encode(), value.encode())
            for key, value in (headers or {}).items()
        ],
        "app": FastAPI(),
    }
    request = Request(scope)
    request.state.project_id = str(PROJECT_ID)
    request.state.user_id = str(uuid4())
    return request


@pytest.fixture(autouse=True)
def _runner_token(monkeypatch):
    monkeypatch.setattr(
        runner_auth, "env", SimpleNamespace(runner=SimpleNamespace(token=RUNNER_TOKEN))
    )


@pytest.fixture(autouse=True)
def _allowed():
    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        yield


def _harness():
    return next(iter(HarnessKind))


def _turns_service():
    service = AsyncMock()

    async def append_turn(*, project_id, user_id, turn):
        return SessionTurn(id=uuid4(), project_id=project_id, **turn.model_dump())

    service.append_turn.side_effect = append_turn
    service.complete_turn.side_effect = lambda *, project_id, turn: SessionTurn(
        id=uuid4(),
        project_id=project_id,
        session_id=turn.session_id,
        stream_id=uuid4(),
        turn_index=turn.turn_index,
        harness_kind=_harness(),
        agent_session_id=turn.agent_session_id,
    )
    return service


def _append_body():
    return SessionTurnAppendRequest(
        session_id="session-1",
        stream_id=uuid4(),
        turn_index=0,
        harness_kind=_harness(),
        agent_session_id="agent-session-1",
        sandbox_id="sandbox-1",
    )


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Agenta-Runner-Token": "wrong-token"},
    ],
)
async def test_append_turn_drops_runtime_ids_without_runner_token(headers):
    service = _turns_service()
    router = SessionTurnsRouter(turns_service=service)

    await router.append_turn(request=_request(headers), body=_append_body())

    turn = service.append_turn.await_args.kwargs["turn"]
    assert turn.agent_session_id is None
    assert turn.sandbox_id is None
    assert turn.session_id == "session-1"


async def test_append_turn_keeps_runtime_ids_from_runner():
    service = _turns_service()
    router = SessionTurnsRouter(turns_service=service)

    await router.append_turn(
        request=_request({"X-Agenta-Runner-Token": RUNNER_TOKEN}),
        body=_append_body(),
    )

    turn = service.append_turn.await_args.kwargs["turn"]
    assert turn.agent_session_id == "agent-session-1"
    assert turn.sandbox_id == "sandbox-1"


async def test_append_turn_drops_runtime_ids_when_no_token_is_configured(
    monkeypatch,
):
    monkeypatch.setattr(
        runner_auth, "env", SimpleNamespace(runner=SimpleNamespace(token=None))
    )
    service = _turns_service()
    router = SessionTurnsRouter(turns_service=service)

    await router.append_turn(
        request=_request({"X-Agenta-Runner-Token": RUNNER_TOKEN}),
        body=_append_body(),
    )

    turn = service.append_turn.await_args.kwargs["turn"]
    assert turn.agent_session_id is None
    assert turn.sandbox_id is None


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({}, None),
        ({"X-Agenta-Runner-Token": RUNNER_TOKEN}, "agent-session-2"),
    ],
)
async def test_complete_turn_keeps_agent_session_id_only_from_runner(headers, expected):
    service = _turns_service()
    router = SessionTurnsRouter(turns_service=service)

    await router.complete_turn(
        request=_request(headers),
        body=SessionTurnCompleteRequest(
            session_id="session-1",
            turn_index=0,
            agent_session_id="agent-session-2",
            end_time=datetime.now(timezone.utc),
        ),
    )

    turn = service.complete_turn.await_args.kwargs["turn"]
    assert turn.agent_session_id == expected
