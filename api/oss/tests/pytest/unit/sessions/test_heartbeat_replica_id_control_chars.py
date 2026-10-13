"""A heartbeat refuses a replica id that holds a control character.

The turn binding stores `replica_id + "\\x1f" + replica_address` and splits at the first
separator. The address is stored only from a beat that carries the runner token, but the id is
stored from any beat with project permission. An id with the separator in it would let a caller
without the runner token write an address of its choosing, and Stop and follow-up turns would
then send the runner token and provider credentials there. The beat is refused at the request
boundary with 422, so the service never runs and no binding is written.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError

from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import SessionHeartbeatRequest
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.contract import turn_bound_key
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.utils.env import env

from unit.sessions.test_heartbeat_turn_binding import _FakeDAO
from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_USER = UUID("00000000-0000-0000-0000-0000000000bb")
_SESSION = "session-control-chars"
_TURN = "turn-1"
_RUNNER_TOKEN = "runner-secret"

_FORGED_IDS = [
    "agenta-runner-6f9c7d5b8-aaaaa\x1fhttps://attacker.example",
    "pod\x00",
    "pod\nhttps://attacker.example",
    "pod\x7f",
    # Python `re` lets `$` match before a final newline; pydantic's Rust engine does not.
    "pod\n",
]
_FORGED_IDS_NAMES = ["unit-separator", "nul", "newline", "delete", "trailing-newline"]

_VALID_IDS = [
    "agenta-runner-6f9c7d5b8-aaaaa",
    "3f0c9a52-7d1e-4b8a-9c2f-5e6d7a8b9c0d",
]
_VALID_IDS_NAMES = ["pod-name", "uuid"]


@pytest.fixture
def redis():
    return _FakeRedis()


@pytest.fixture
def client(redis, monkeypatch):
    monkeypatch.setattr(env.runner, "token", _RUNNER_TOKEN)
    engine = LockEngine()
    service = SessionStreamsService(streams_dao=_FakeDAO(), lock_engine=engine)
    app = FastAPI()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = _PROJECT
        request.state.user_id = _USER
        return await call_next(request)

    app.include_router(
        SessionStreamsRouter(service=service, interactions_service=AsyncMock()).router
    )
    with (
        patch.object(engine, "_client", return_value=redis),
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        yield TestClient(app)


def _beat(client: TestClient, replica_id: str, *, with_runner_token: bool = False):
    return client.post(
        "/sessions/streams/heartbeat",
        json={
            "session_id": _SESSION,
            "replica_id": replica_id,
            "turn_id": _TURN,
        },
        headers={"X-Agenta-Runner-Token": _RUNNER_TOKEN} if with_runner_token else {},
    )


def _stored_binding(redis: _FakeRedis):
    return redis._values.get(turn_bound_key(str(_PROJECT), _SESSION, _TURN))


@pytest.mark.parametrize("replica_id", _FORGED_IDS, ids=_FORGED_IDS_NAMES)
def test_the_request_refuses_a_replica_id_with_a_control_character(replica_id):
    with pytest.raises(ValidationError):
        SessionHeartbeatRequest(session_id=_SESSION, replica_id=replica_id)


@pytest.mark.parametrize("replica_id", _FORGED_IDS, ids=_FORGED_IDS_NAMES)
def test_a_beat_with_a_control_character_in_its_replica_id_is_422_and_binds_nothing(
    client, redis, replica_id
):
    response = _beat(client, replica_id)

    assert response.status_code == 422
    assert _stored_binding(redis) is None


def test_a_runner_verified_beat_with_the_separator_in_its_replica_id_is_422(
    client, redis
):
    response = _beat(client, _FORGED_IDS[0], with_runner_token=True)

    assert response.status_code == 422
    assert _stored_binding(redis) is None


@pytest.mark.parametrize("replica_id", _VALID_IDS, ids=_VALID_IDS_NAMES)
def test_a_beat_with_a_normal_replica_id_still_binds_the_turn(
    client, redis, replica_id
):
    response = _beat(client, replica_id)

    assert response.status_code == 200
    assert response.json()["is_current_turn"] is True
    assert _stored_binding(redis) == f"{replica_id}\x1f".encode()
