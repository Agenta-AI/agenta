"""One execution, one terminal writer: the watchdog settles the Stop the runner never reported.

Two slices meet here. The durable-cancel slice writes a Stop command, hands it to the runner,
and settles it when the runner reports. It deliberately builds no sweep, so a runner that dies
between the claim and the report leaves the command `claimed` for ever and the session reading
"stopping". The watchdog slice already sweeps executions whose runner went silent. These tests
pin the agreed handover: the SAME pass settles both halves, so no second sweep can race it.

The rule the tests hold:

  * a claimed command whose session has stopped beating is settled `obsolete` with outcome
    `lost`, and the settlement runs the same side effects a reported one runs;
  * a claimed command whose session is still beating is left alone, because its runner is
    merely late and telling the user the Stop failed would be a lie;
  * the sweep runs the command settlement in the same pass that collapses the stale rows, and
    AFTER them, so the runner-gone case needs one pass and not two.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import uuid4

import pytest

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamFlags
from oss.src.tasks.asyncio.sessions.orphan_sweep import run_orphan_sweep

from unit.sessions.test_session_cancel_admission import (
    _FakeCommandsDAO,
    _FakeInteractionsService,
    _FakeStreamsService,
    _service,
    lock_engine,  # noqa: F401  (pytest fixture, imported for use)
)
from unit.sessions.test_execution_watchdog import (
    _FakeRecordsService,
    _FakeRedis,
    _FakeTransactionsEngine,
    _Publisher,
    _stale_running_row,
)

_PROJECT = uuid4()
_SESSION = "session_abandoned_command"
_TARGET_TURN = "turn-being-stopped"


class _ExpiringDAO(_FakeCommandsDAO):
    """A DAO holding one command the sweep should find, claimed or merely pending."""

    def __init__(self, command: SessionCommand) -> None:
        super().__init__()
        self.rows = [command]
        self.expire_calls: List[dict] = []
        self.unclaimed_calls: List[dict] = []
        self.cleared_turn_ids: List[Optional[str]] = []

    async def expire_claims(self, *, now, max_deliveries, pending_before=None):
        self.expire_calls.append(
            {
                "now": now,
                "max_deliveries": max_deliveries,
                "pending_before": pending_before,
            }
        )
        return [
            row
            for row in self.rows
            if row.state == SessionCommandState.claimed
            or (
                row.state == SessionCommandState.pending
                and pending_before is not None
                and row.created_at is not None
                and row.created_at < pending_before
            )
        ]

    async def expire_unclaimed(self, *, older_than):
        self.unclaimed_calls.append({"older_than": older_than})
        return [
            row
            for row in self.rows
            if row.state == SessionCommandState.pending
            and row.created_at is not None
            and row.created_at < older_than
        ]

    async def clear_stopping_turn(self, *, project_id, session_id, turn_id=None):
        self.cleared_turn_ids.append(turn_id)


def _claimed_command() -> SessionCommand:
    now = datetime.now(timezone.utc)
    return SessionCommand(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        kind=SessionCommandKind.cancel,
        target_turn_id=_TARGET_TURN,
        state=SessionCommandState.claimed,
        claimed_by="runner-that-died",
        claim_expires_at=now - timedelta(seconds=30),
        claim_count=1,
        created_at=now - timedelta(seconds=200),
        updated_at=now - timedelta(seconds=200),
    )


def _stream(*, beat_age_seconds: int, is_alive: bool = True) -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        turn_id=_TARGET_TURN,
        flags=SessionStreamFlags(is_alive=is_alive, is_running=is_alive),
        updated_at=datetime.now(timezone.utc) - timedelta(seconds=beat_age_seconds),
    )


@pytest.mark.asyncio
async def test_a_claimed_command_whose_runner_is_gone_settles_lost(lock_engine):  # noqa: F811
    """The runner accepted the Stop and died. Nobody will ever report, so the sweep does."""
    command = _claimed_command()
    dao = _ExpiringDAO(command)
    interactions = _FakeInteractionsService()
    streams = _FakeStreamsService(_stream(beat_age_seconds=300))
    svc = _service(lock_engine, dao=dao, streams=streams, interactions=interactions)

    settled_count = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled_count == 1
    settled = dao.rows[0]
    assert settled.state == SessionCommandState.obsolete
    assert settled.outcome == SessionCommandOutcome.lost
    # The session must stop reading "stopping", or the browser shows a Stop that never ends.
    assert dao.cleared_turn_ids == [_TARGET_TURN]
    # A gate belonging to the stopped execution can never be answered; close it, and only it.
    assert interactions.cancelled == [_TARGET_TURN]
    # Open readers are told the session ended.
    assert streams.ended == [_SESSION]


@pytest.mark.asyncio
async def test_a_claimed_command_whose_runner_still_beats_is_left_alone(lock_engine):  # noqa: F811
    """A late report is not a lost one. Settling here would tell the user the Stop failed."""
    command = _claimed_command()
    dao = _ExpiringDAO(command)
    interactions = _FakeInteractionsService()
    streams = _FakeStreamsService(_stream(beat_age_seconds=1))
    svc = _service(lock_engine, dao=dao, streams=streams, interactions=interactions)

    settled_count = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled_count == 0
    assert dao.rows[0].state == SessionCommandState.claimed
    assert dao.cleared_turn_ids == []
    assert interactions.cancelled == []
    assert streams.ended == []


@pytest.mark.asyncio
async def test_a_command_no_runner_ever_claimed_settles_lost(lock_engine):  # noqa: F811
    """The shape a runner restart actually produces: the delivery never reached a runner.

    The claim is written only after a runner accepts the delivery, so a Stop sent while the
    runner is down leaves the row `pending` with `claim_count` zero. `expire_claims` reads
    `claimed` rows only, so without this the session read "stopping" for ever. Observed live
    on the integration stack: command 01a0644c-63a1-70f1-b8a2-1e4c35fbc766 sat `pending` for
    five minutes with no sweep able to see it.
    """
    command = _claimed_command().model_copy(
        update={
            "state": SessionCommandState.pending,
            "claimed_by": None,
            "claim_expires_at": None,
            "claim_count": 0,
        }
    )
    dao = _ExpiringDAO(command)
    interactions = _FakeInteractionsService()
    streams = _FakeStreamsService(_stream(beat_age_seconds=300))
    svc = _service(lock_engine, dao=dao, streams=streams, interactions=interactions)

    settled_count = await svc.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled_count == 1
    assert dao.rows[0].state == SessionCommandState.obsolete
    assert dao.rows[0].outcome == SessionCommandOutcome.lost
    assert dao.cleared_turn_ids == [_TARGET_TURN]
    assert interactions.cancelled == [_TARGET_TURN]


@pytest.mark.asyncio
async def test_a_pending_command_younger_than_the_deadline_is_left_alone(lock_engine):  # noqa: F811
    """A Stop admitted seconds ago may still be in delivery. Do not settle it."""
    command = _claimed_command().model_copy(
        update={
            "state": SessionCommandState.pending,
            "claimed_by": None,
            "claim_expires_at": None,
            "claim_count": 0,
            "created_at": datetime.now(timezone.utc),
        }
    )
    dao = _ExpiringDAO(command)
    streams = _FakeStreamsService(_stream(beat_age_seconds=300))
    svc = _service(lock_engine, dao=dao, streams=streams)

    assert await svc.settle_abandoned_commands(now=datetime.now(timezone.utc)) == 0
    assert dao.rows[0].state == SessionCommandState.pending


class _RecordingCommandsService:
    """Stands in for the commands plane, to observe WHEN the sweep calls it."""

    def __init__(self, row) -> None:
        self.calls: List[datetime] = []
        self.flags_at_call: List[dict] = []
        self._row = row

    async def settle_abandoned_commands(self, *, now: datetime) -> int:
        self.calls.append(now)
        self.flags_at_call.append(dict(self._row.flags))
        return 1


@pytest.mark.asyncio
async def test_the_sweep_settles_commands_after_it_collapses_the_stale_rows():
    """One pass, both halves, in the order that makes the runner-gone case settle at once.

    A command is only abandoned when its session has stopped beating. The collapse is what
    makes that true for every row in this batch, so calling the commands plane first would
    leave a restarted runner's Stop waiting for a second pass.
    """
    row = _stale_running_row()
    commands = _RecordingCommandsService(row)

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        commands_service=commands,
        publish=_Publisher(),
    )

    assert len(commands.calls) == 1
    assert commands.flags_at_call[0] == {
        "is_alive": False,
        "is_running": False,
        "is_attached": False,
    }


@pytest.mark.asyncio
async def test_a_failing_command_settlement_never_stops_the_execution_sweep():
    """The executions are the sweep's first duty; a commands-plane fault must not cost them."""

    class _Broken:
        async def settle_abandoned_commands(self, *, now):
            raise RuntimeError("commands plane is down")

    row = _stale_running_row()
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        commands_service=_Broken(),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["error", "done"]
    assert row.flags == {
        "is_alive": False,
        "is_running": False,
        "is_attached": False,
    }
