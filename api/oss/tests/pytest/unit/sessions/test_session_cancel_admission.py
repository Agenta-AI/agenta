"""What a Stop request decides before anything durable is written.

Admission is where a Stop can go wrong in the two ways that matter to a user. It can miss the
run they meant, and it can kill a run they never meant. These pin the rules that stop both:

  * the arrival time is stamped BEFORE any read, and stored as the row's `created_at`, so the
    value the guard compared is the value the runner can re-compare;
  * a stale `expected_execution_id` is refused and writes nothing at all;
  * an execution that started AFTER the request arrived is never targeted;
  * a parked session, which holds `alive` and not `running`, is still reachable;
  * two Stops in a row collapse onto one command;
  * Redis is not written at admission, so the stopping execution keeps its locks while it stops.
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
import uuid_utils.compat as uuid

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands import service as commands_service_module
from oss.src.core.sessions.commands.types import ExecutionExpectationFailed
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamFlags
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    get_alive_owner,
    get_running_owner,
    get_session_liveness,
)
from oss.src.utils.env import env
from oss.src.tasks.asyncio.sessions.orphan_sweep import _repair_terminal_redis

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_cancel_admission"


class _FakeCommandsDAO:
    """Enough of the DAO to observe what admission wrote, and how many times."""

    def __init__(self) -> None:
        self.rows: List[SessionCommand] = []
        self.stopping_turn_ids: List[Optional[str]] = []
        self.claims: List[Dict] = []
        self.abandoned: List[SessionCommand] = []

    async def create_command(
        self, *, user_id, command: SessionCommandCreate, stopping_turn_id=None
    ):
        row = SessionCommand(
            id=uuid.uuid7(),
            project_id=command.project_id,
            session_id=command.session_id,
            kind=command.kind,
            target_turn_id=command.target_turn_id,
            expected_turn_id=command.expected_turn_id,
            data=command.data,
            state=command.state,
            outcome=command.outcome,
            settled_at=command.settled_at,
            idempotency_key=command.idempotency_key,
            created_at=command.created_at,
        )
        self.rows.append(row)
        self.stopping_turn_ids.append(stopping_turn_id)
        return row

    async def fetch_open_command(self, *, project_id, session_id, kind, target_turn_id):
        for row in reversed(self.rows):
            if (
                row.project_id == project_id
                and row.session_id == session_id
                and row.kind == kind
                and row.target_turn_id == target_turn_id
                and row.state
                in (SessionCommandState.pending, SessionCommandState.claimed)
            ):
                return row
        return None

    async def fetch_command(self, *, command_id, project_id=None):
        for row in self.rows:
            if row.id == command_id:
                return row
        return None

    async def claim_for_delivery(
        self, *, project_id, command_id, replica_id, lease_seconds
    ):
        # A copy, never a mutation of the object the caller holds — the real DAO returns a
        # fresh row from RETURNING *, so admission's own view of the command stays as it was.
        self.claims.append({"command_id": command_id, "replica_id": replica_id})
        for index, row in enumerate(self.rows):
            if row.id == command_id and row.state == SessionCommandState.pending:
                claimed = row.model_copy(
                    update={
                        "state": SessionCommandState.claimed,
                        "claimed_by": replica_id,
                    }
                )
                self.rows[index] = claimed
                return claimed
        return None

    async def record_delivery_attempt(
        self, *, project_id, command_id, now, max_deliveries
    ):
        for index, row in enumerate(self.rows):
            if (
                row.id == command_id
                and row.state
                in (SessionCommandState.pending, SessionCommandState.claimed)
                and row.claim_count < max_deliveries
            ):
                attempted = row.model_copy(
                    update={
                        "state": SessionCommandState.pending,
                        "claimed_by": None,
                        "claim_expires_at": None,
                        "claim_count": row.claim_count + 1,
                        "updated_at": now,
                    }
                )
                self.rows[index] = attempted
                return attempted
        return None

    async def claim_commands(self, **_):
        return []

    async def settle_command(self, *, settle):
        for index, row in enumerate(self.rows):
            if row.id == settle.command_id and row.state in settle.expected_states:
                # Mirrors the real guard: a `pending` row holds no claim, so a null
                # `claimed_by` passes; a claimed row must be claimed by the reporter.
                if (
                    settle.replica_id is not None
                    and row.claimed_by is not None
                    and row.claimed_by != settle.replica_id
                ):
                    return None
                settled = row.model_copy(
                    update={
                        "state": settle.state,
                        "outcome": settle.outcome,
                        "settled_at": datetime.now(timezone.utc),
                    }
                )
                self.rows[index] = settled
                return settled
        return None

    async def clear_stopping_turn(self, *, project_id, session_id, turn_id=None):
        self.stopping_turn_ids.append(None)

    async def expire_claims(self, *, now, max_deliveries, pending_before=None):
        return self.abandoned


class _FakeStreamsService:
    """The reads admission makes, plus the row settlement writes.

    `mirrored` stands in for the `session_streams` row. It records the nest exactly as the real
    `_mirror_flags` would read it — from Redis, at the moment settlement calls — so a test can
    assert what the ROW says and not merely that a call happened. `query_streams`, which is what
    the product's liveness polls read, serves that row and never looks at Redis.
    """

    def __init__(
        self, stream: Optional[SessionStream] = None, lock_engine=None
    ) -> None:
        self.stream = stream
        self.ended: List[str] = []
        self.lock_engine = lock_engine
        self.mirrored: List[Dict[str, bool]] = []

    async def fetch_header(self, *, project_id: UUID, session_id: str):
        return self.stream

    async def publish_session_ended(self, *, project_id: UUID, session_id: str):
        self.ended.append(session_id)

    async def mirror_liveness(self, *, project_id: UUID, session_id: str, user_id=None):
        snap = await get_session_liveness(
            self.lock_engine, project_id=str(project_id), session_id=session_id
        )
        self.mirrored.append(
            {
                "is_alive": snap["alive"],
                "is_running": snap["running"],
                "is_attached": snap["attached"],
            }
        )


class _FakeInteractionsService:
    def __init__(self) -> None:
        self.cancelled: List[Optional[str]] = []

    async def cancel_session_pending(
        self, *, project_id, session_id, only_turn_id=None, **_
    ):
        self.cancelled.append(only_turn_id)
        return 1


class _RecordingDelivery:
    def __init__(self, status: str = "accepted") -> None:
        self.status = status
        self.delivered: List[SessionCommand] = []

    async def deliver(self, *, command: SessionCommand) -> DeliveryReceipt:
        self.delivered.append(command)
        return DeliveryReceipt(status=self.status, replica_id="runner-1")

    async def acknowledge(self, *, command_id, replica_id) -> None:
        return None


class _FakeExecutionsDAO:
    def __init__(self) -> None:
        self.rows: Dict[tuple[str, str], SessionExecutionSettlement] = {}
        self.commands = None
        self.interactions = None

    async def settle(
        self,
        *,
        project_id,
        session_id,
        execution_id,
        terminal_outcome,
        settled_by,
        settled_at=None,
    ):
        key = (session_id, execution_id)
        if key in self.rows:
            return SessionExecutionSettlementResult(
                settlement=self.rows[key], won=False
            )
        row = SessionExecutionSettlement(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            terminal_outcome=terminal_outcome,
            settled_by=settled_by,
            settled_at=settled_at or datetime.now(timezone.utc),
        )
        self.rows[key] = row
        return SessionExecutionSettlementResult(settlement=row, won=True)

    async def settle_command_execution(
        self,
        *,
        settle,
        session_id,
        execution_id,
        terminal_outcome,
        settled_by,
        mirror_stopped,
        cancel_interactions,
    ):
        if execution_id and terminal_outcome and settled_by:
            result = await self.settle(
                project_id=settle.project_id,
                session_id=session_id,
                execution_id=execution_id,
                terminal_outcome=terminal_outcome,
                settled_by=settled_by,
            )
            winner = result.settlement
            if not result.won and (
                winner.terminal_outcome != terminal_outcome
                or winner.settled_by != settled_by
            ):
                return None
        command = await self.commands.settle_command(settle=settle)
        if command is None:
            return None
        await self.commands.clear_stopping_turn(
            project_id=settle.project_id,
            session_id=session_id,
            turn_id=execution_id,
        )
        if cancel_interactions and execution_id:
            await self.interactions.cancel_session_pending(
                project_id=settle.project_id,
                session_id=session_id,
                only_turn_id=execution_id,
            )
        return command

    async def list_redis_unreconciled(self, *, limit):
        return [
            row
            for row in self.rows.values()
            if row.settled_by == "runner"
            and row.terminal_outcome == "stopped"
            and row.redis_reconciled_at is None
        ][:limit]

    async def mark_redis_reconciled(self, *, project_id, session_id, execution_id):
        key = (session_id, execution_id)
        self.rows[key] = self.rows[key].model_copy(
            update={"redis_reconciled_at": datetime.now(timezone.utc)}
        )


def _stream(
    turn_id: Optional[str], turn_started_at: Optional[datetime]
) -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        turn_id=turn_id,
        turn_started_at=turn_started_at,
        flags=SessionStreamFlags(is_alive=True, is_running=True),
        updated_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(
    lock_engine,
    *,
    dao=None,
    streams=None,
    interactions=None,
    delivery=None,
    executions=None,
):
    streams = streams or _FakeStreamsService()
    # The fake mirrors from Redis, so it reads the same engine the service writes through.
    if streams.lock_engine is None:
        streams.lock_engine = lock_engine
    commands = dao or _FakeCommandsDAO()
    interactions = interactions or _FakeInteractionsService()
    if executions is not None:
        executions.commands = commands
        executions.interactions = interactions
    return SessionCommandsService(
        commands_dao=commands,
        streams_service=streams,
        interactions_service=interactions,
        lock_engine=lock_engine,
        delivery=delivery or _RecordingDelivery(),
        executions_dao=executions,
    )


async def _run_turn(lock_engine, turn_id: str) -> None:
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn_id
    )
    await acquire_running(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn_id
    )


@pytest.mark.asyncio
async def test_stop_on_a_running_turn_is_accepted_and_pins_the_target(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery()
    started = datetime.now(timezone.utc) - timedelta(seconds=30)
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(_stream("turn-A", started)),
        delivery=delivery,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is True
    assert admission.execution_id == "turn-A"
    assert admission.command.state == SessionCommandState.pending
    assert admission.command.target_turn_id == "turn-A"
    # The row and the session marker are written together.
    assert dao.stopping_turn_ids == ["turn-A"]
    assert len(delivery.delivered) == 1


@pytest.mark.asyncio
async def test_admission_does_not_touch_redis(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    svc = _service(
        lock_engine,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
    )

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    # The stopping execution keeps both locks WHILE it stops, which is what prevents a second
    # message from starting underneath it.
    assert (
        await get_running_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-A"
    )
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-A"
    )


@pytest.mark.asyncio
async def test_stop_when_nothing_runs_is_settled_at_once(lock_engine):
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery()
    svc = _service(lock_engine, dao=dao, delivery=delivery)

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is False
    assert admission.execution_id is None
    assert admission.command.state == SessionCommandState.obsolete
    assert admission.command.outcome == SessionCommandOutcome.not_running
    assert delivery.delivered == [], "nothing to deliver to"
    assert dao.stopping_turn_ids == [None], "no session is stopping"


@pytest.mark.asyncio
async def test_stale_expected_execution_id_is_refused_and_writes_nothing(lock_engine):
    await _run_turn(lock_engine, "turn-B")
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-B", datetime.now(timezone.utc) - timedelta(seconds=5))
        ),
        delivery=delivery,
    )

    with pytest.raises(ExecutionExpectationFailed) as excinfo:
        await svc.request_cancel(
            project_id=_PROJECT,
            user_id=_USER,
            session_id=_SESSION,
            expected_execution_id="turn-A",
        )

    assert excinfo.value.current == "turn-B"
    assert dao.rows == [], "a refused Stop must insert nothing"
    assert delivery.delivered == []


@pytest.mark.asyncio
async def test_a_turn_that_started_after_the_request_is_never_targeted(lock_engine):
    # The race: the user presses Stop, turn one ends, turn two starts, and only then does the
    # request get applied. Turn two must not hear about it.
    await _run_turn(lock_engine, "turn-two")
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-two", datetime.now(timezone.utc) + timedelta(seconds=5))
        ),
        delivery=delivery,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is False
    assert admission.execution_id is None
    assert admission.command.target_turn_id is None
    assert admission.command.outcome == SessionCommandOutcome.superseded_by_newer_turn
    assert delivery.delivered == [], "the newer turn is never contacted"
    # And its locks are untouched.
    assert (
        await get_running_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-two"
    )


@pytest.mark.asyncio
async def test_the_guard_does_not_fire_when_the_start_time_is_unknown(lock_engine):
    # A row written before `turn_started_at` existed yields no comparison. Failing this way
    # round is deliberate: refusing every Stop we cannot verify would break the common case.
    await _run_turn(lock_engine, "turn-A")
    svc = _service(lock_engine, streams=_FakeStreamsService(_stream("turn-A", None)))

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is True
    assert admission.command.target_turn_id == "turn-A"


@pytest.mark.asyncio
async def test_the_stored_created_at_is_the_value_that_was_compared(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    before = datetime.now(timezone.utc)
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
    )

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)
    after = datetime.now(timezone.utc)

    stored = dao.rows[0].created_at
    assert stored is not None
    # Stamped by the service, not defaulted by the server: the runner repeats this comparison.
    assert before <= stored <= after


@pytest.mark.asyncio
async def test_a_parked_session_is_reachable_through_the_alive_owner(lock_engine):
    # A session awaiting an approval holds `alive` and not `running`, and it has stopped
    # heartbeating. This is the case with no control channel at all today.
    await acquire_alive(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-parked",
    )
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        streams=_FakeStreamsService(_stream("turn-parked", None)),
        delivery=delivery,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is True
    assert admission.execution_id == "turn-parked"
    assert len(delivery.delivered) == 1


@pytest.mark.asyncio
async def test_a_named_stop_reaches_a_parked_approval(lock_engine):
    """The Stop the browser actually sends, on the session state Stop exists to reach.

    A parked approval has released `running` and still holds `alive` under the same turn id.
    The browser always sends `expected_execution_id`, because it knows the id it streamed. If
    the expectation is compared against `running` alone it is None here, so the named Stop is
    refused with a conflict while the identical Stop without an expectation is accepted — the
    guard firing on the one case it exists to allow, and the gate left pending.
    """
    await acquire_alive(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-parked",
    )
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

    assert admission.accepted is True
    assert admission.execution_id == "turn-parked"
    assert len(delivery.delivered) == 1


@pytest.mark.asyncio
async def test_a_named_stop_on_a_parked_session_still_refuses_a_different_turn(
    lock_engine,
):
    """The guard must keep working on the fallback, not merely stop firing.

    A user looking at a turn that finished, on a session now parked under a NEWER turn, must
    still be refused: the id they named is not the one that would be stopped.
    """
    await acquire_alive(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-new",
    )
    dao = _FakeCommandsDAO()
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(_stream("turn-new", None)),
        delivery=delivery,
    )

    with pytest.raises(ExecutionExpectationFailed) as excinfo:
        await svc.request_cancel(
            project_id=_PROJECT,
            user_id=_USER,
            session_id=_SESSION,
            expected_execution_id="turn-old",
        )

    assert excinfo.value.current == "turn-new"
    assert dao.rows == []
    assert delivery.delivered == []


@pytest.mark.asyncio
async def test_two_stops_in_a_row_collapse_onto_one_command(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
    )

    first = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    second = await svc.request_cancel(
        project_id=_PROJECT,
        user_id=_USER,
        session_id=_SESSION,
        idempotency_key="a-different-key",
    )

    assert len(dao.rows) == 1, "one intent, one command"
    assert second.command.id == first.command.id
    assert second.accepted is True


@pytest.mark.asyncio
async def test_a_reachable_runner_that_does_not_hold_the_session_settles_at_once(
    lock_engine,
):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    streams = _FakeStreamsService(
        _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
    )
    # A row that has not beaten for a long time: the session really did end, so `not_running`
    # is the honest answer rather than the wrong-replica failure.
    streams.stream.updated_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    interactions = _FakeInteractionsService()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=streams,
        interactions=interactions,
        delivery=_RecordingDelivery(status="not_held"),
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is True, "the caller still gets a durable command"
    assert dao.rows[0].state == SessionCommandState.obsolete
    assert dao.rows[0].outcome == SessionCommandOutcome.not_running
    assert interactions.cancelled == ["turn-A"]
    assert streams.ended == [_SESSION]


@pytest.mark.asyncio
async def test_not_held_on_a_beating_session_is_reported_as_lost_not_finished(
    lock_engine,
):
    # The wrong-replica failure. The user must be told the Stop failed, never that the work had
    # already finished. `_run_turn` holds `running`, which is the discriminator: an execution is
    # being run somewhere, and it is not by the process we called.
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    streams = _FakeStreamsService(
        _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
    )
    svc = _service(
        lock_engine,
        dao=dao,
        streams=streams,
        delivery=_RecordingDelivery(status="not_held"),
    )

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert dao.rows[0].outcome == SessionCommandOutcome.lost


@pytest.mark.asyncio
async def test_not_held_on_a_turn_that_just_ended_is_not_running_not_lost(lock_engine):
    """The everyday late Stop: the answer landed, the user pressed Stop a moment after.

    The turn released `running` and left `alive` and a fresh heartbeat behind it, exactly as a
    RUNNING turn would, so a beating-row test calls this a failed Stop and tells the user their
    Stop was lost. Nothing was lost: the work finished. `running` is what separates the two,
    because a session nobody is executing has no `running` owner at all.
    """
    # `alive` only, which is what a turn leaves when it ends.
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-A"
    )
    dao = _FakeCommandsDAO()
    streams = _FakeStreamsService(
        _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
    )
    # Beating, and recently: the turn ended seconds ago, not half an hour ago.
    streams.stream.updated_at = datetime.now(timezone.utc)
    svc = _service(
        lock_engine,
        dao=dao,
        streams=streams,
        delivery=_RecordingDelivery(status="not_held"),
    )

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert dao.rows[0].state == SessionCommandState.obsolete
    assert dao.rows[0].outcome == SessionCommandOutcome.not_running


@pytest.mark.asyncio
async def test_an_unreachable_runner_leaves_the_command_open(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        delivery=_RecordingDelivery(status="unreachable"),
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    # Admission still succeeded. The command is durable, so a later delivery or the settlement
    # sweep gives the user a terminal state instead of a Stop that vanished.
    assert admission.accepted is True
    assert dao.rows[0].state == SessionCommandState.pending


@pytest.mark.asyncio
async def test_settlement_releases_running_and_leaves_alive_alone(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    streams = _FakeStreamsService(
        _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
    )
    interactions = _FakeInteractionsService()
    svc = _service(lock_engine, dao=dao, streams=streams, interactions=interactions)

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    await svc.report_outcome(
        command_id=admission.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="turn-A",
        execution_state="stopped",
    )

    assert dao.rows[0].state == SessionCommandState.applied
    assert dao.rows[0].outcome == SessionCommandOutcome.stopped
    assert (
        await get_running_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        is None
    ), "running is released under an owner check"
    # THE assertion that pins warm resume. Force-deleting `alive` is what makes today's cancel
    # read as a session teardown; Stop must leave the session as a finished turn leaves it.
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-A"
    )
    assert interactions.cancelled == ["turn-A"]
    assert streams.ended == [_SESSION]


@pytest.mark.asyncio
async def test_settlement_writes_the_row_as_alive_and_not_running(lock_engine):
    """The ROW, not only Redis — the row is the only thing the product's liveness polls read.

    Redis is already right the moment settlement returns, and the test above pins that. The row
    is a separate write, and nothing else performs it: settlement tombstones the execution first,
    so the runner's own final `is_running=false` heartbeat is refused before it reaches the
    heartbeat's mirror write. Left unwritten, the row says `is_running: true` until the orphan
    sweep collapses it minutes later, and the tab that pressed Stop shows its own session as
    running somewhere else for that whole time.
    """
    await _run_turn(lock_engine, "turn-A")
    streams = _FakeStreamsService(
        _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
    )
    svc = _service(lock_engine, streams=streams)

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    await svc.report_outcome(
        command_id=admission.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="turn-A",
        execution_state="stopped",
    )

    # Written once, and written AFTER `running` was released — a mirror taken before the release
    # would have recorded `is_running: True` and been exactly the bug.
    assert streams.mirrored == [
        {"is_alive": True, "is_running": False, "is_attached": False}
    ]
    # And the mirror is the state a normally finished turn leaves behind, which is what makes
    # the session read as resumable rather than as torn down.
    assert streams.mirrored[-1]["is_alive"] is True


@pytest.mark.asyncio
async def test_a_settlement_that_stops_nothing_does_not_touch_the_row(lock_engine):
    """`not_running` changes no lock, so it must not write the row either.

    An obsolete Stop lands here: the turn it named had already finished, a NEWER turn may hold
    the nest, and a mirror write from this path would be a write the settlement has no business
    making. The row is left to the live turn's own heartbeats.
    """
    dao = _FakeCommandsDAO()
    streams = _FakeStreamsService(None)
    svc = _service(lock_engine, dao=dao, streams=streams)

    # Nothing running and nothing parked: admission settles the command at insert.
    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert admission.accepted is False
    assert dao.rows[0].outcome == SessionCommandOutcome.not_running
    assert streams.mirrored == []


@pytest.mark.asyncio
async def test_an_outcome_that_beats_the_claim_still_settles(lock_engine):
    """The race the runner wins on a fast abort, driven at the exact instant it happens.

    Admission inserts the command `pending`, hands it to the runner, and writes `claimed` only
    after the runner answers. A runner that aborts inside that window reports its outcome while
    the row still says `pending`. Guarded on `claimed` alone that report was refused with a
    conflict, the command sat open, and the sweep later recorded a Stop that actually worked as
    lost — with the user watching "stopping" for the whole sweep window.

    The delivery double below reports from inside `deliver`, which is precisely where the real
    runner's report lands relative to the claim.
    """
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    holder: Dict[str, SessionCommandsService] = {}

    class _ReportsBeforeTheClaimCommits:
        def __init__(self) -> None:
            self.delivered: List[SessionCommand] = []
            self.state_at_report: Optional[SessionCommandState] = None

        async def deliver(self, *, command):
            self.delivered.append(command)
            # The window. Nothing has written `claimed` yet, and the runner is already done.
            self.state_at_report = dao.rows[0].state
            await holder["svc"].report_outcome(
                command_id=command.id,
                replica_id="runner-1",
                result="applied",
                execution_id="turn-A",
                execution_state="stopped",
            )
            return DeliveryReceipt(status="accepted", replica_id="runner-1")

        async def acknowledge(self, *, command_id, replica_id):
            return None

    delivery = _ReportsBeforeTheClaimCommits()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=5))
        ),
        delivery=delivery,
    )
    holder["svc"] = svc

    await svc.request_cancel(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert delivery.state_at_report == SessionCommandState.pending, (
        "the test is only meaningful if the report really did beat the claim"
    )
    assert dao.rows[0].state == SessionCommandState.applied
    assert dao.rows[0].outcome == SessionCommandOutcome.stopped
    # And the claim that arrives afterwards must not resurrect a settled command.
    assert dao.rows[0].state == SessionCommandState.applied


@pytest.mark.asyncio
async def test_an_outcome_from_a_replica_that_does_not_hold_the_claim_is_refused(
    lock_engine,
):
    """Widening the guard to `pending` must not weaken it for a row that IS claimed.

    A claimed row names its holder, and only that holder may write the outcome. The null
    `claimed_by` this change now admits exists solely for the unclaimed row.
    """
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=5))
        ),
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    assert dao.rows[0].state == SessionCommandState.claimed

    from oss.src.core.sessions.commands.types import SessionCommandNotClaimable

    with pytest.raises(SessionCommandNotClaimable):
        await svc.report_outcome(
            command_id=admission.command.id,
            replica_id="a-different-replica",
            result="applied",
            execution_id="turn-A",
            execution_state="stopped",
        )

    assert dao.rows[0].state == SessionCommandState.claimed


@pytest.mark.asyncio
async def test_a_second_outcome_report_changes_nothing(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    interactions = _FakeInteractionsService()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        interactions=interactions,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    await svc.report_outcome(
        command_id=admission.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="turn-A",
        execution_state="stopped",
    )
    from oss.src.core.sessions.commands.types import SessionCommandNotClaimable

    with pytest.raises(SessionCommandNotClaimable):
        await svc.report_outcome(
            command_id=admission.command.id,
            replica_id="runner-1",
            result="applied",
            execution_id="turn-A",
            execution_state="stopped",
        )

    assert interactions.cancelled == ["turn-A"], "the side effects run exactly once"


@pytest.mark.asyncio
async def test_runner_outcome_settles_the_execution_authority(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    executions = _FakeExecutionsDAO()
    svc = _service(
        lock_engine,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        executions=executions,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    await svc.report_outcome(
        command_id=admission.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="turn-A",
        execution_state="stopped",
    )

    winner = executions.rows[(_SESSION, "turn-A")]
    assert winner.terminal_outcome == "stopped"
    assert winner.settled_by == "runner"


@pytest.mark.asyncio
async def test_watchdog_cannot_replace_the_runners_terminal_outcome(lock_engine):
    executions = _FakeExecutionsDAO()
    svc = _service(lock_engine, executions=executions)
    first = await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id="turn-A",
        terminal_outcome="stopped",
        settled_by="runner",
    )
    assert first.won is True

    won = await svc.settle_execution_lost(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id="turn-A",
        settled_at=datetime.now(timezone.utc),
    )

    assert won is False
    assert executions.rows[(_SESSION, "turn-A")].terminal_outcome == "stopped"


@pytest.mark.asyncio
async def test_next_sweep_repairs_a_post_commit_redis_failure(lock_engine, monkeypatch):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    executions = _FakeExecutionsDAO()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        executions=executions,
    )
    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    supersede = AsyncMock(side_effect=RuntimeError("injected after commit"))
    monkeypatch.setattr(commands_service_module, "mark_turn_superseded", supersede)

    with pytest.raises(RuntimeError, match="injected after commit"):
        await svc.report_outcome(
            command_id=admission.command.id,
            replica_id="runner-1",
            result="applied",
            execution_id="turn-A",
            execution_state="stopped",
        )

    assert dao.rows[0].state == SessionCommandState.applied
    assert executions.rows[(_SESSION, "turn-A")].redis_reconciled_at is None

    supersede.side_effect = None
    repaired = await _repair_terminal_redis(svc)

    assert repaired == 1
    assert executions.rows[(_SESSION, "turn-A")].redis_reconciled_at is not None


def _abandoned_command(*, claim_count: int = 1) -> SessionCommand:
    return SessionCommand(
        id=uuid.uuid7(),
        project_id=_PROJECT,
        session_id=_SESSION,
        kind="cancel",
        target_turn_id="turn-A",
        state=SessionCommandState.pending,
        claim_count=claim_count,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )


@pytest.mark.asyncio
async def test_a_pending_command_is_redelivered_while_the_session_beats(lock_engine):
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

    settled = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled == 0
    assert [row.id for row in delivery.delivered] == [command.id]
    assert dao.rows[0].claim_count == command.claim_count + 1


@pytest.mark.asyncio
async def test_a_pending_command_is_settled_lost_when_the_runner_is_gone(lock_engine):
    command = _abandoned_command()
    dao = _FakeCommandsDAO()
    dao.rows = [command]
    dao.abandoned = [command]
    delivery = _RecordingDelivery()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream(
                "turn-A",
                datetime.now(timezone.utc) - timedelta(minutes=5),
            ).model_copy(
                update={"updated_at": datetime.now(timezone.utc) - timedelta(minutes=5)}
            )
        ),
        delivery=delivery,
    )

    settled = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled == 1
    assert delivery.delivered == []
    assert dao.rows[0].state == SessionCommandState.obsolete
    assert dao.rows[0].outcome == SessionCommandOutcome.lost


@pytest.mark.asyncio
async def test_redelivery_stops_at_the_configured_maximum(lock_engine, monkeypatch):
    maximum = 2
    monkeypatch.setattr(env.agenta.sessions.commands, "max_deliveries", maximum)
    command = _abandoned_command(claim_count=maximum)
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

    settled = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled == 1
    assert delivery.delivered == []
    assert dao.rows[0].outcome == SessionCommandOutcome.lost


@pytest.mark.asyncio
async def test_a_superseded_report_leaves_the_newer_turns_locks_alone(lock_engine):
    await _run_turn(lock_engine, "turn-A")
    dao = _FakeCommandsDAO()
    interactions = _FakeInteractionsService()
    svc = _service(
        lock_engine,
        dao=dao,
        streams=_FakeStreamsService(
            _stream("turn-A", datetime.now(timezone.utc) - timedelta(seconds=30))
        ),
        interactions=interactions,
    )

    admission = await svc.request_cancel(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    await svc.report_outcome(
        command_id=admission.command.id,
        replica_id="runner-1",
        result="obsolete",
        execution_id="turn-A",
        execution_state="superseded_by_newer_turn",
    )

    assert dao.rows[0].outcome == SessionCommandOutcome.superseded_by_newer_turn
    # Nothing was stopped, so nothing is released and no gate is cancelled.
    assert (
        await get_running_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-A"
    )
    assert interactions.cancelled == []
