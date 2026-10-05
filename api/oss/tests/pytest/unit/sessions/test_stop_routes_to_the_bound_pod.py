"""Stop goes to the runner pod bound to the target turn, not to a random pod.

`_deliver` reads the target turn's binding on every attempt, the first delivery and every sweep
redelivery alike, and hands its address to the transport. The direct transport posts `/cancel`
there. With no address (compose, Railway, or a turn no pod has beaten yet) it posts to the
Service URL, as it did before bindings existed.

The receipts stay distinct: a 404 from the pod is `not_held` and settles at once, while a
transport failure is `unreachable` and leaves the command to the abandoned-command sweep.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import pytest_asyncio

from oss.src.core.sessions.commands.dtos import SessionCommandState
from oss.src.core.sessions.streams.runner_client import (
    RunnerCancelResponse,
    RunnerCancelResult,
    cancel_runner_execution,
)
from oss.src.dbs.http.sessions import control_delivery_direct
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.dbs.redis.sessions.locks import acquire_alive, bind_turn

from unit.sessions.test_project_scoped_locks import _FakeRedis
from unit.sessions.test_session_cancel_admission import (
    _PROJECT,
    _SESSION,
    _USER,
    _FakeCommandsDAO,
    _FakeStreamsService,
    _RecordingDelivery,
    _abandoned_command,
    _run_turn,
    _service,
    _stream,
)


_POD_A = "agenta-runner-6f9c7d5b8-aaaaa"
_ADDRESS_A = "http://10.8.2.17:8765"
_SERVICE_URL = "http://agenta-runner:8765"


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


async def _bind(lock_engine, turn_id: str, address: str = _ADDRESS_A) -> None:
    await bind_turn(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id=turn_id,
        replica_id=_POD_A,
        replica_address=address,
    )


def _running_stream(turn_id: str = "turn-A"):
    return _FakeStreamsService(
        _stream(turn_id, datetime.now(timezone.utc) - timedelta(seconds=30))
    )


# --------------------------------------------------------------------------- #
# The delivery boundary resolves the address
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_first_delivery_goes_to_the_pod_bound_to_the_target_turn(
    lock_engine,
):
    await _run_turn(lock_engine, "turn-A")
    await _bind(lock_engine, "turn-A")
    delivery = _RecordingDelivery()
    svc = _service(lock_engine, streams=_running_stream(), delivery=delivery)

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert delivery.addresses == [_ADDRESS_A]


@pytest.mark.asyncio
async def test_a_sweep_redelivery_goes_to_the_same_pod(lock_engine):
    await _bind(lock_engine, "turn-A")
    command = _abandoned_command()
    dao = _FakeCommandsDAO()
    dao.rows = [command]
    dao.abandoned = [command]
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(_stream("turn-A", datetime.now(timezone.utc))),
        delivery=delivery,
    )

    await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert [row.id for row in delivery.delivered] == [command.id]
    assert delivery.addresses == [_ADDRESS_A]


@pytest.mark.asyncio
async def test_an_empty_bound_address_uses_the_service_url(lock_engine):
    """Compose and Railway report no address, and a beat without the runner token stores
    none. Both bind the turn with an empty address."""
    await _run_turn(lock_engine, "turn-A")
    await _bind(lock_engine, "turn-A", address="")
    delivery = _RecordingDelivery()
    svc = _service(lock_engine, streams=_running_stream(), delivery=delivery)

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert delivery.addresses == [None]


@pytest.mark.asyncio
async def test_a_turn_with_no_binding_uses_the_service_url(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    delivery = _RecordingDelivery()
    svc = _service(lock_engine, streams=_running_stream(), delivery=delivery)

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert delivery.addresses == [None]


@pytest.mark.asyncio
async def test_a_stop_on_a_parked_approval_goes_to_the_pod_that_parked_it(
    lock_engine,
):
    """A parked turn holds `alive` without `running` and does not beat. Its binding still
    names the pod that holds the parked prompt."""
    await acquire_alive(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-parked",
    )
    await _bind(lock_engine, "turn-parked")
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        streams=_FakeStreamsService(_stream("turn-parked", None)),
        delivery=delivery,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT,
        user_id=_USER,
        session_id=_SESSION,
        expected_execution_id="turn-parked",
    )

    assert admission.execution_id == "turn-parked"
    assert delivery.addresses == [_ADDRESS_A]


@pytest.mark.asyncio
async def test_not_held_from_the_bound_pod_settles_at_once(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_running_stream(),
        delivery=_RecordingDelivery(status="not_held"),
    )

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert dao.rows[0].state == SessionCommandState.obsolete


@pytest.mark.asyncio
async def test_an_unreachable_bound_pod_leaves_the_command_to_the_sweep(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery(status="unreachable")
    svc = _service(lock_engine, dao=dao, streams=_running_stream(), delivery=delivery)

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert dao.rows[0].state == SessionCommandState.pending, (
        "a transport failure must not settle the command the way not_held does"
    )

    dao.abandoned = [dao.rows[0]]
    await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert delivery.addresses == [_ADDRESS_A, _ADDRESS_A]


# --------------------------------------------------------------------------- #
# The direct transport posts to the address
# --------------------------------------------------------------------------- #


class _FakeRunnerEnv:
    internal_url = _SERVICE_URL
    token = "shared-secret"


def _client_answering(status_code: int, captured: dict):
    class _FakeResponse:
        def __init__(self) -> None:
            self.status_code = status_code

        def json(self):
            return {"ok": True, "replicaId": _POD_A}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["headers"] = headers
            return _FakeResponse()

    return _FakeClient()


def _client_failing():
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            raise httpx.ConnectError("connection refused")

    return _FakeClient()


async def _cancel(base_url=None):
    return await cancel_runner_execution(
        command_id="cmd-1",
        project_id="proj-1",
        session_id="sess-1",
        target_turn_id="turn-A",
        created_at="",
        base_url=base_url,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "base_url,expected_url",
    [
        (_ADDRESS_A, f"{_ADDRESS_A}/cancel"),
        (None, f"{_SERVICE_URL}/cancel"),
    ],
    ids=["bound-pod", "service-url"],
)
async def test_cancel_posts_to_the_bound_pod_or_the_service_url(base_url, expected_url):
    captured: dict = {}
    with (
        patch(
            "oss.src.core.sessions.streams.runner_client.env",
            runner=_FakeRunnerEnv(),
        ),
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_client_answering(202, captured),
        ),
    ):
        answer = await _cancel(base_url)

    assert answer == RunnerCancelResponse(RunnerCancelResult.accepted, _POD_A)
    assert captured["url"] == expected_url
    assert captured["headers"]["Authorization"] == "Bearer shared-secret"


@pytest.mark.asyncio
async def test_a_404_from_the_bound_pod_is_not_held_and_a_transport_failure_is_not():
    with (
        patch(
            "oss.src.core.sessions.streams.runner_client.env",
            runner=_FakeRunnerEnv(),
        ),
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_client_answering(404, {}),
        ),
    ):
        not_held = await _cancel(_ADDRESS_A)

    with (
        patch(
            "oss.src.core.sessions.streams.runner_client.env",
            runner=_FakeRunnerEnv(),
        ),
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_client_failing(),
        ),
    ):
        unreachable = await _cancel(_ADDRESS_A)

    assert not_held.status == RunnerCancelResult.not_held
    assert unreachable.status == RunnerCancelResult.unreachable


@pytest.mark.asyncio
async def test_the_direct_adapter_passes_the_address_to_the_runner_call():
    command = _abandoned_command()
    cancel = AsyncMock(
        return_value=RunnerCancelResponse(RunnerCancelResult.accepted, _POD_A)
    )

    with patch.object(control_delivery_direct, "cancel_runner_execution", cancel):
        receipt = await DirectControlDelivery(timeout_seconds=1.0).deliver(
            command=command, runner_address=_ADDRESS_A
        )

    assert receipt.status == "accepted"
    assert receipt.replica_id == _POD_A
    assert cancel.await_args.kwargs["base_url"] == _ADDRESS_A
