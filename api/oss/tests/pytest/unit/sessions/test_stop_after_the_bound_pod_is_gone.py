"""A Stop or a Send Now still settles after the pod that held the turn is gone.

A runner restart ends the running turn with the restart error and a final `is_running: false`
beat. The turn keeps `alive` (its own one-hour time to live) and its binding still names the
old pod. When that turn was an approval continuation, the api keeps its execution `running`,
because an error ending does not settle a continuation, so the next message is queued behind
it. Send Now is the way out: it sends a cancel for that turn, and the runner's `not_held`
answer settles it `not_running`, which promotes the queued message.

The cancel goes to the bound pod's address only when the pod there answers `/health` as the
bound replica. After a restart nothing answers as the old pod, so the cancel was `unreachable`,
the abandoned-command sweep later settled it `lost`, and `lost` never promotes the queued
message. The session stayed queued for good.

A turn never moves between pods, so a bound pod that is gone holds nothing, and the answer is
the same as `not_held`. That holds only for a turn that does not hold `running`. A turn that
holds `running` is executing somewhere, and a failed identity check can be a slow live pod,
so that cancel stays `unreachable` and waits for the sweep, as before.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

from oss.src.core.sessions.commands.dtos import (
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.streams.runner_client import (
    RunnerCancelResponse,
    RunnerCancelResult,
)
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.dbs.redis.sessions.locks import acquire_alive

from unit.sessions.test_session_cancel_admission import (
    _PROJECT,
    _SESSION,
    _USER,
    _FakeCommandsDAO,
    _FakeExecutionsDAO,
    _FakeStreamsService,
    _run_turn,
    _service,
    _stream,
)
from unit.sessions.test_project_scoped_locks import _FakeRedis
from unit.sessions.test_stop_routes_to_the_bound_pod import (
    _ADDRESS_A,
    _POD_A,
    _FakeRunnerHttp,
    _bind,
    _cancel,
)


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _ended_stream(turn_id: str = "turn-A"):
    """The row a restart-ended turn leaves: alive, not running, fresh last beat."""
    streams = _FakeStreamsService(
        _stream(turn_id, datetime.now(timezone.utc) - timedelta(minutes=10))
    )
    streams.stream.flags.is_running = False
    streams.stream.updated_at = datetime.now(timezone.utc)
    return streams


async def _deliver_through_the_real_transport(svc, http, **request):
    with (
        patch(
            "oss.src.core.sessions.streams.runner_client.env",
            runner=type(
                "_Env",
                (),
                {"internal_url": "http://agenta-runner:8765", "token": "secret"},
            )(),
        ),
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            new=http.client,
        ),
    ):
        return await svc.request_cancel(
            project_id=_PROJECT, user_id=_USER, session_id=_SESSION, **request
        )


# --------------------------------------------------------------------------- #
# The transport names the case
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "http",
    [
        _FakeRunnerHttp(health_replica_id="agenta-runner-new-pod"),
        _FakeRunnerHttp(health_error=httpx.ConnectError("refused")),
        _FakeRunnerHttp(health_error=httpx.ConnectTimeout("timed out")),
    ],
    ids=["ip-reused-by-another-pod", "refused", "timed-out"],
)
async def test_a_bound_address_that_is_not_the_bound_replica_is_replica_gone(http):
    answer = await _cancel(http, _ADDRESS_A, runner_replica_id=_POD_A)

    assert answer == RunnerCancelResponse(RunnerCancelResult.replica_gone)
    assert http.posts == [], "the runner token never goes to an unverified address"


# --------------------------------------------------------------------------- #
# The service settles it
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_cancel_for_an_ended_turn_whose_pod_is_gone_settles_not_running(
    lock_engine,
):
    """The F2 journey: the turn ended with the restart error, its pod is gone, and the user
    presses Send Now (a cancel bound to that turn)."""
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-A"
    )
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_ended_stream(),
        delivery=DirectControlDelivery(timeout_seconds=1.0),
    )
    http = _FakeRunnerHttp(health_replica_id="agenta-runner-new-pod")

    await _deliver_through_the_real_transport(svc, http, expected_execution_id="turn-A")

    assert http.posts == []
    assert dao.rows[0].state == SessionCommandState.obsolete, (
        "the cancel must settle at once, not wait for the sweep to call it lost"
    )
    assert dao.rows[0].outcome == SessionCommandOutcome.not_running


@pytest.mark.asyncio
async def test_a_cancel_for_a_running_turn_whose_pod_fails_the_check_stays_open(
    lock_engine,
):
    """Fail closed: a running turn is executing somewhere. A failed identity check can be a
    slow live pod, so the command waits for the sweep, which reads the binding again."""
    await _run_turn(lock_engine, "turn-A")
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        delivery=DirectControlDelivery(timeout_seconds=1.0),
    )
    http = _FakeRunnerHttp(health_error=httpx.ConnectTimeout("timed out"))

    await _deliver_through_the_real_transport(svc, http)

    assert http.posts == []
    assert dao.rows[0].state == SessionCommandState.pending


@pytest.mark.asyncio
async def test_send_now_on_an_ended_turn_whose_pod_is_gone_promotes_its_input(
    lock_engine,
):
    """Send Now is a cancel that carries the queued input. The settlement promotes that input
    only when the command settles `not_running` (or `stopped`) with the input bound to it, so
    check the promotion itself, not only the outcome."""
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-A"
    )
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    executions = _FakeExecutionsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_ended_stream(),
        delivery=DirectControlDelivery(timeout_seconds=1.0),
        executions=executions,
    )
    promote = AsyncMock(return_value=None)
    svc._promote_next_input = promote
    queued = uuid4()
    http = _FakeRunnerHttp(health_error=httpx.ConnectError("refused"))

    await _deliver_through_the_real_transport(
        svc, http, expected_execution_id="turn-A", steer_input_id=queued
    )

    assert http.posts == []
    assert dao.rows[0].outcome == SessionCommandOutcome.not_running
    assert executions.rows[(_SESSION, "turn-A")].terminal_outcome == "not_running"
    promote.assert_awaited_once()
    assert promote.await_args.kwargs["input_id"] == queued
    assert promote.await_args.kwargs["parent_execution_id"] == "turn-A"
    assert promote.await_args.kwargs["only_policy"] == "steer"


@pytest.mark.asyncio
async def test_a_failed_lock_read_keeps_the_cancel_open_and_the_request_answered(
    lock_engine,
):
    """The command is committed before delivery. A Redis failure while judging the gone pod
    must not turn the admitted request into an error; the sweep keeps recovery open."""
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-A"
    )
    await _bind(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_ended_stream(),
        delivery=DirectControlDelivery(timeout_seconds=1.0),
    )
    svc._judge_gone_replica = AsyncMock(side_effect=ConnectionError("redis is down"))
    http = _FakeRunnerHttp(health_replica_id="agenta-runner-new-pod")

    admission = await _deliver_through_the_real_transport(
        svc, http, expected_execution_id="turn-A"
    )

    assert admission.command.id == dao.rows[0].id
    assert http.posts == []
    assert dao.rows[0].state == SessionCommandState.pending
