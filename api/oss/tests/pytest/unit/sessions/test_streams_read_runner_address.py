"""`GET /sessions/streams/` names the runner pod that ran the stream's last turn.

The services layer reads this route before every turn and posts `/run` to the pod it names, so a
follow-up reaches the pod that holds the warm session. The value is the address in the binding of
the stream row's `turn_id`. Browsers read the same route, and a pod address is internal to the
cluster, so the address is filled only for a caller with a valid runner token; every other
caller, and every case with no binding or no address, reads `""`.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import bind_turn
from oss.src.utils.env import env

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_USER = UUID("00000000-0000-0000-0000-0000000000bb")
_SESSION = "session_runner_address"
_TOKEN = "runner-secret"
_ADDRESS = "http://10.8.2.17:8765"


class _FakeDAO:
    def __init__(self, row):
        self.row = row

    async def get_by_session_id(self, *, project_id, session_id):
        return self.row


def _row(turn_id):
    return SessionStream(
        id=uuid4(), project_id=_PROJECT, session_id=_SESSION, turn_id=turn_id
    )


def _request(headers=None):
    return SimpleNamespace(
        state=SimpleNamespace(project_id=_PROJECT, user_id=_USER),
        headers=headers or {},
    )


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


@pytest.fixture(autouse=True)
def _allowed(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(env.runner, "token", _TOKEN)


async def _bind(engine, turn_id, address=_ADDRESS):
    await bind_turn(
        engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id=turn_id,
        replica_id="agenta-runner-6f9c7d5b8-aaaaa",
        replica_address=address,
    )


async def _read(engine, row, headers):
    service = SessionStreamsService(streams_dao=_FakeDAO(row), lock_engine=engine)
    router = SessionStreamsRouter(service=service, interactions_service=None)
    return await router.fetch_session_stream(_request(headers), session_id=_SESSION)


@pytest.mark.asyncio
async def test_the_runner_token_reads_the_address_of_the_last_turns_pod(lock_engine):
    await _bind(lock_engine, "turn-2")

    response = await _read(
        lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": _TOKEN}
    )

    assert response.runner_address == _ADDRESS
    assert response.stream.turn_id == "turn-2"
    assert "runner_address" not in response.stream.model_dump()


@pytest.mark.asyncio
async def test_the_address_follows_the_rows_turn_not_an_older_one(lock_engine):
    await _bind(lock_engine, "turn-1", "http://10.8.2.18:8765")
    await _bind(lock_engine, "turn-2")

    response = await _read(
        lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": _TOKEN}
    )

    assert response.runner_address == _ADDRESS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [{}, {"X-Agenta-Runner-Token": "wrong-secret"}],
    ids=["no-token", "wrong-token"],
)
async def test_a_caller_without_a_valid_runner_token_reads_no_address(
    lock_engine, headers
):
    await _bind(lock_engine, "turn-2")

    response = await _read(lock_engine, _row("turn-2"), headers)

    assert response.runner_address == ""
    assert response.stream.turn_id == "turn-2"


@pytest.mark.asyncio
async def test_a_deployment_with_no_runner_token_gives_no_address(
    lock_engine, monkeypatch
):
    monkeypatch.setattr(env.runner, "token", None)
    await _bind(lock_engine, "turn-2")

    response = await _read(lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": ""})

    assert response.runner_address == ""


@pytest.mark.asyncio
async def test_a_turn_with_no_binding_reads_no_address(lock_engine):
    response = await _read(
        lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": _TOKEN}
    )

    assert response.runner_address == ""


@pytest.mark.asyncio
async def test_a_binding_with_no_address_reads_no_address(lock_engine):
    await _bind(lock_engine, "turn-2", address="")

    response = await _read(
        lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": _TOKEN}
    )

    assert response.runner_address == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("row", [None, _row(None)], ids=["no-row", "no-turn"])
async def test_a_stream_with_no_turn_reads_no_address(lock_engine, row):
    response = await _read(lock_engine, row, {"X-Agenta-Runner-Token": _TOKEN})

    assert response.runner_address == ""


@pytest.mark.asyncio
async def test_a_failed_binding_read_costs_the_address_not_the_read(
    lock_engine, monkeypatch
):
    from oss.src.core.sessions.streams import service as streams_service_module

    monkeypatch.setattr(
        streams_service_module,
        "get_turn_binding",
        AsyncMock(side_effect=ConnectionError("redis down")),
    )

    response = await _read(
        lock_engine, _row("turn-2"), {"X-Agenta-Runner-Token": _TOKEN}
    )

    assert response.runner_address == ""
    assert response.stream.turn_id == "turn-2"
