"""Stop goes to the runner pod bound to the target turn, not to a random pod.

`_deliver` reads the target turn's binding on every attempt, the first delivery and every sweep
redelivery alike, and hands its address to the transport. The direct transport posts `/cancel`
there. With no address (compose, Railway, or a turn no pod has beaten yet) it posts to the
Service URL, as it did before bindings existed.

Before the post, the transport asks the pod at the address for its replica id on `/health`.
Kubernetes can give a dead pod's IP to another pod, so the token goes there only when the id
equals the binding's. Any other answer is `replica_gone`, with nothing posted.

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
    runner_address_is_replica,
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
    # The transport checks the pod at the address against this id before it posts.
    assert delivery.replica_ids == [_POD_A]


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
    assert delivery.replica_ids == [None]


@pytest.mark.asyncio
async def test_a_turn_with_no_binding_uses_the_service_url(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    delivery = _RecordingDelivery()
    svc = _service(lock_engine, streams=_running_stream(), delivery=delivery)

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert delivery.addresses == [None]
    assert delivery.replica_ids == [None]


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


class _FakeResponse:
    def __init__(self, status_code: int, payload) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no JSON body")
        return self._payload


class _FakeRunnerHttp:
    """Stands in for `httpx.AsyncClient`: answers `/health` and `/cancel` and records each
    client's timeout, each call, and each health check's own timeout."""

    def __init__(
        self,
        *,
        cancel_status: int = 202,
        health_replica_id=_POD_A,
        health_error: Exception | None = None,
        cancel_error: Exception | None = None,
    ) -> None:
        self.cancel_status = cancel_status
        self.health_replica_id = health_replica_id
        self.health_error = health_error
        self.cancel_error = cancel_error
        self.timeouts: list = []
        self.get_timeouts: list = []
        self.gets: list = []
        self.posts: list = []

    def client(self, *args, timeout=None, **kwargs):
        self.timeouts.append(timeout)
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None, timeout=None):
        self.gets.append({"url": url, "headers": headers})
        self.get_timeouts.append(timeout)
        if self.health_error is not None:
            raise self.health_error
        return _FakeResponse(200, {"status": "ok", "replicaId": self.health_replica_id})

    async def post(self, url, json=None, headers=None):
        self.posts.append({"url": url, "headers": headers})
        if self.cancel_error is not None:
            raise self.cancel_error
        return _FakeResponse(self.cancel_status, {"ok": True, "replicaId": _POD_A})


async def _cancel(http: _FakeRunnerHttp, base_url=None, runner_replica_id=_POD_A):
    with (
        patch(
            "oss.src.core.sessions.streams.runner_client.env",
            runner=_FakeRunnerEnv(),
        ),
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            new=http.client,
        ),
    ):
        return await cancel_runner_execution(
            command_id="cmd-1",
            project_id="proj-1",
            session_id="sess-1",
            target_turn_id="turn-A",
            created_at="",
            base_url=base_url,
            runner_replica_id=runner_replica_id,
        )


@pytest.mark.asyncio
async def test_cancel_checks_the_pod_identity_then_posts_to_the_bound_pod():
    http = _FakeRunnerHttp()

    answer = await _cancel(http, _ADDRESS_A)

    assert answer == RunnerCancelResponse(RunnerCancelResult.accepted, _POD_A)
    assert http.gets == [{"url": f"{_ADDRESS_A}/health", "headers": None}], (
        "the identity check carries no runner token"
    )
    assert [post["url"] for post in http.posts] == [f"{_ADDRESS_A}/cancel"]
    assert http.posts[0]["headers"]["Authorization"] == "Bearer shared-secret"


@pytest.mark.asyncio
async def test_cancel_without_an_address_posts_to_the_service_url_with_no_check():
    http = _FakeRunnerHttp()

    answer = await _cancel(http, None, runner_replica_id=None)

    assert answer.status == RunnerCancelResult.accepted
    assert http.gets == []
    assert [post["url"] for post in http.posts] == [f"{_SERVICE_URL}/cancel"]
    assert http.timeouts[0].connect == 5.0, (
        "the Service URL keeps the caller's whole timeout for the connect"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "http,runner_replica_id",
    [
        (_FakeRunnerHttp(health_replica_id="some-other-pod"), _POD_A),
        (_FakeRunnerHttp(health_replica_id=None), _POD_A),
        (_FakeRunnerHttp(health_error=httpx.ConnectError("refused")), _POD_A),
        (_FakeRunnerHttp(health_error=httpx.ConnectTimeout("timed out")), _POD_A),
        (_FakeRunnerHttp(), None),
        (_FakeRunnerHttp(), ""),
    ],
    ids=[
        "another-replica",
        "not-a-runner",
        "health-error",
        "health-timeout",
        "no-replica-id",
        "empty-replica-id",
    ],
)
async def test_cancel_sends_nothing_to_an_address_that_is_not_the_bound_replica(
    http, runner_replica_id
):
    """A reused pod IP must not receive the runner token. The answer is `replica_gone`, and
    the service decides what it means (see `test_stop_after_the_bound_pod_is_gone.py`)."""
    answer = await _cancel(http, _ADDRESS_A, runner_replica_id=runner_replica_id)

    assert answer == RunnerCancelResponse(RunnerCancelResult.replica_gone)
    assert http.posts == []


@pytest.mark.asyncio
async def test_the_bound_pod_gets_a_two_second_connect_bound():
    http = _FakeRunnerHttp()

    await _cancel(http, _ADDRESS_A)

    (client_timeout,) = http.timeouts
    assert http.get_timeouts == [2.0]
    assert client_timeout.connect == 2.0
    assert client_timeout.read == 5.0, "the read keeps the caller's whole timeout"


@pytest.mark.asyncio
async def test_a_404_from_the_bound_pod_is_not_held_and_a_transport_failure_is_not():
    not_held = await _cancel(_FakeRunnerHttp(cancel_status=404), _ADDRESS_A)
    unreachable = await _cancel(
        _FakeRunnerHttp(cancel_error=httpx.ConnectError("connection refused")),
        _ADDRESS_A,
    )

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
            command=command, runner_address=_ADDRESS_A, runner_replica_id=_POD_A
        )

    assert receipt.status == "accepted"
    assert receipt.replica_id == _POD_A
    assert cancel.await_args.kwargs["base_url"] == _ADDRESS_A
    assert cancel.await_args.kwargs["runner_replica_id"] == _POD_A


def _health_answering(handler) -> httpx.AsyncClient:
    """A real client with a mock transport, so URL parsing and `.json()` stay real."""
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _raises(error):
    def handler(request):
        raise error

    return handler


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address,handler",
    [
        (_ADDRESS_A, lambda request: httpx.Response(200, text="<html>ok</html>")),
        (_ADDRESS_A, lambda request: httpx.Response(500, json={"replicaId": _POD_A})),
        (_ADDRESS_A, lambda request: httpx.Response(200, json=[_POD_A])),
        (_ADDRESS_A, _raises(httpx.ReadTimeout("no answer"))),
        (_ADDRESS_A, _raises(httpx.RemoteProtocolError("garbage"))),
        ("http://[not-an-address", lambda request: httpx.Response(200)),
    ],
    ids=[
        "not-json",
        "not-200",
        "not-an-object",
        "read-timeout",
        "protocol-error",
        "invalid-url",
    ],
)
async def test_every_health_check_failure_is_false_and_never_raises(address, handler):
    async with _health_answering(handler) as client:
        assert (
            await runner_address_is_replica(client, address=address, replica_id=_POD_A)
            is False
        )


@pytest.mark.asyncio
async def test_the_health_check_reads_the_replica_id_from_a_real_answer():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"status": "ok", "replicaId": _POD_A})

    async with _health_answering(handler) as client:
        assert await runner_address_is_replica(
            client, address=_ADDRESS_A, replica_id=_POD_A
        )

    assert [str(request.url) for request in requests] == [f"{_ADDRESS_A}/health"]
    assert "authorization" not in requests[0].headers
