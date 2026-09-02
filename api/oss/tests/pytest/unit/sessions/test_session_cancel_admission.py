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
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
import uuid_utils.compat as uuid

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.types import ExecutionExpectationFailed
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamFlags
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    get_alive_owner,
    get_running_owner,
)

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

    async def create_command(self, *, user_id, command: SessionCommandCreate, stopping_turn_id=None):
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

    async def claim_for_delivery(self, *, project_id, command_id, replica_id, lease_seconds):
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

    async def claim_commands(self, **_):
        return []

    async def settle_command(self, *, settle):
        for index, row in enumerate(self.rows):
            if row.id == settle.command_id and row.state == settle.expected_state:
                if settle.replica_id is not None and row.claimed_by != settle.replica_id:
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

    async def expire_claims(self, *, now, max_deliveries):
        return []


class _FakeStreamsService:
    """Only the two reads admission and settlement make."""

    def __init__(self, stream: Optional[SessionStream] = None) -> None:
        self.stream = stream
        self.ended: List[str] = []

    async def fetch_header(self, *, project_id: UUID, session_id: str):
        return self.stream

    async def publish_session_ended(self, *, project_id: UUID, session_id: str):
        self.ended.append(session_id)


class _FakeInteractionsService:
    def __init__(self) -> None:
        self.cancelled: List[Optional[str]] = []

    async def cancel_session_pending(self, *, project_id, session_id, only_turn_id=None, **_):
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


def _stream(turn_id: Optional[str], turn_started_at: Optional[datetime]) -> SessionStream:
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


def _service(lock_engine, *, dao=None, streams=None, interactions=None, delivery=None):
    return SessionCommandsService(
        commands_dao=dao or _FakeCommandsDAO(),
        streams_service=streams or _FakeStreamsService(),
        interactions_service=interactions or _FakeInteractionsService(),
        lock_engine=lock_engine,
        delivery=delivery or _RecordingDelivery(),
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
        await get_alive_owner(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)
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
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-parked"
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
async def test_not_held_on_a_beating_session_is_reported_as_lost_not_finished(lock_engine):
    # The wrong-replica failure. The user must be told the Stop failed, never that the work had
    # already finished.
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
        await get_alive_owner(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)
        == "turn-A"
    )
    assert interactions.cancelled == ["turn-A"]
    assert streams.ended == [_SESSION]


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
