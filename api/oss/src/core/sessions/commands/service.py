"""Durable session commands — admission, delivery and settlement.

Version one has one command kind, `cancel`, which the product calls Stop.

WHAT STOP MEANS HERE. Stop ends the WORK, not the session. The sandbox stays warm, the native
harness session stays resumable, and the next message continues the same conversation. That is
why this service never force-deletes the Redis `alive` key: it leaves it to its own time to
live, exactly as the end of an ordinary turn does. Force-deleting `alive` is what makes today's
cancel read as a session teardown.

THE ORDER OF ADMISSION.

  1. Stamp the arrival time FIRST, before reading anything.
  2. Resolve the target execution once, from Redis `running`, falling back to `alive`.
  3. Apply the three late-Stop guards (below).
  4. Insert the command and stamp `session_streams.stopping_turn_id` in ONE transaction.
  5. Only then call the runner. Delivery failure never fails the request, because the command
     is already durable.

Redis is not written at admission. The stopping execution keeps `alive` and `running` while it
stops, which is what prevents a second message from starting underneath it.

THE LATE-STOP GUARDS. A Stop that arrives after its turn ended must not kill the next turn.

  * The caller's `expected_execution_id`, when sent, must name the running execution. It does
    not, the request is refused with a conflict and nothing is written.
  * When no expectation was sent and the running execution started AFTER this request arrived,
    the command is inserted already settled and targets nothing.
  * The target is resolved once and pinned. A turn that starts later has a different id, so a
    pinned command can never reach it. The runner repeats the comparison against its own memory,
    which is exact.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandSettle,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import (
    ControlDeliveryPort,
    SessionCommandsDAOInterface,
)
from oss.src.core.sessions.commands.types import (
    ExecutionExpectationFailed,
    SessionCommandNotClaimable,
    SessionCommandNotFound,
)
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.streams.dtos import SessionStreamCommandRequest
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionIdInvalid
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    HEARTBEAT_INTERVAL_SECONDS,
    validate_session_id,
)
from oss.src.dbs.redis.sessions.locks import (
    get_alive_owner,
    get_owner,
    get_running_owner,
    mark_turn_superseded,
    release_running,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class CancelAdmission:
    """What admission decided, in the shape the route answers with."""

    def __init__(
        self,
        *,
        command: SessionCommand,
        execution_id: Optional[str],
        accepted: bool,
    ) -> None:
        self.command = command
        # What the caller should render: the execution being stopped, or nothing.
        self.execution_id = execution_id
        # True when an execution was running or parked and the command is on its way. The route
        # answers 202 for it and 200 otherwise.
        self.accepted = accepted


class SessionCommandsService:
    def __init__(
        self,
        *,
        commands_dao: SessionCommandsDAOInterface,
        streams_service: SessionStreamsService,
        interactions_service: SessionInteractionsService,
        lock_engine: LockEngine,
        delivery: ControlDeliveryPort,
        executions_dao: Optional[SessionExecutionsDAOInterface] = None,
    ) -> None:
        self._dao = commands_dao
        self._streams = streams_service
        self._interactions = interactions_service
        self._lock = lock_engine
        self._delivery = delivery
        self._executions = executions_dao

    # -- admission ---------------------------------------------------------- #

    async def request_cancel_legacy(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> None:
        """Use the heartbeat-carried Stop path kept for rollout rollback."""
        await self._streams.command(
            project_id=project_id,
            user_id=user_id,
            request=SessionStreamCommandRequest(session_id=session_id),
        )

    async def request_cancel(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        expected_execution_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> CancelAdmission:
        if not validate_session_id(session_id):
            raise SessionIdInvalid(session_id)

        # FIRST, before any read. The value compared below is the value stored as the row's
        # `created_at`, so the runner can repeat the same comparison against its own memory.
        received_at = datetime.now(timezone.utc)

        target_turn_id, turn_started_at = await self._resolve_target(
            project_id=project_id,
            session_id=session_id,
        )

        if (
            expected_execution_id is not None
            and target_turn_id != expected_execution_id
        ):
            # Compared against the TARGET, which is `running` with a fallback to `alive`, and
            # never against `running` alone. An execution parked on an approval has released
            # `running` and still holds `alive` under the same turn id, and it is exactly the
            # execution the user is looking at when they press Stop on the approval card. The
            # browser always sends the id it streamed, so comparing against `running` alone
            # refused every named Stop on a parked approval while the same Stop without an
            # expectation was accepted — the guard fired on the one case it exists to allow.
            #
            # Nothing is inserted and nothing is delivered. The caller was looking at a run
            # that has already ended, and its next read tells it so.
            raise ExecutionExpectationFailed(
                expected=expected_execution_id, current=target_turn_id
            )

        if target_turn_id is None:
            # Nothing is running and nothing is parked. Record the intent so a retry with the
            # same key gets the same answer, and settle it in the same write.
            command = await self._insert(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                received_at=received_at,
                target_turn_id=None,
                expected_turn_id=expected_execution_id,
                idempotency_key=idempotency_key,
                state=SessionCommandState.obsolete,
                outcome=SessionCommandOutcome.not_running,
            )
            return CancelAdmission(command=command, execution_id=None, accepted=False)

        if (
            expected_execution_id is None
            and turn_started_at is not None
            and turn_started_at > received_at
        ):
            # The execution now running began AFTER the user pressed Stop, so it is not the one
            # they meant. Do not target it, do not touch Redis, and tell the caller there is
            # nothing of theirs left to stop.
            command = await self._insert(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                received_at=received_at,
                target_turn_id=None,
                expected_turn_id=None,
                idempotency_key=idempotency_key,
                state=SessionCommandState.obsolete,
                outcome=SessionCommandOutcome.superseded_by_newer_turn,
            )
            return CancelAdmission(command=command, execution_id=None, accepted=False)

        # Two Stops in a row are one intent. Collapse onto the open command for the same target
        # BEFORE inserting, so this holds even when the caller sends a different idempotency key.
        open_command = await self._dao.fetch_open_command(
            project_id=project_id,
            session_id=session_id,
            kind=SessionCommandKind.cancel,
            target_turn_id=target_turn_id,
        )
        if open_command is not None:
            if open_command.state == SessionCommandState.pending:
                # Nobody has taken it. The first delivery may have failed, so try again; the
                # runner deduplicates by command id, so a duplicate arrival aborts nothing twice.
                await self._deliver(open_command)
            return CancelAdmission(
                command=open_command,
                execution_id=target_turn_id,
                accepted=True,
            )

        command = await self._insert(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            received_at=received_at,
            target_turn_id=target_turn_id,
            expected_turn_id=expected_execution_id,
            idempotency_key=idempotency_key,
            state=SessionCommandState.pending,
            outcome=None,
            stopping_turn_id=target_turn_id,
        )
        # The row is committed. Everything from here is promptness, not correctness.
        await self._deliver(command)
        return CancelAdmission(
            command=command, execution_id=target_turn_id, accepted=True
        )

    async def _resolve_target(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Tuple[Optional[str], Optional[datetime]]:
        """The execution to stop, and when it started.

        `running` first, then `alive`. A session parked awaiting an approval holds `alive` and
        not `running`, and Stop must reach it: that is the case with no control channel at all
        today, because a parked session stops heartbeating.
        """
        turn_id = await get_running_owner(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        if turn_id is None:
            turn_id = await get_alive_owner(
                self._lock, project_id=str(project_id), session_id=session_id
            )
        if turn_id is None:
            return None, None

        stream = await self._streams.fetch_header(
            project_id=project_id, session_id=session_id
        )
        started_at = None
        if stream is not None and stream.turn_id == turn_id:
            # Only when the row agrees about WHICH turn is running. A start time read off a row
            # that names a different turn would compare two unrelated things.
            started_at = stream.turn_started_at
        return turn_id, started_at

    async def _insert(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        received_at: datetime,
        target_turn_id: Optional[str],
        expected_turn_id: Optional[str],
        idempotency_key: Optional[str],
        state: SessionCommandState,
        outcome: Optional[SessionCommandOutcome],
        stopping_turn_id: Optional[str] = None,
    ) -> SessionCommand:
        return await self._dao.create_command(
            user_id=user_id,
            command=SessionCommandCreate(
                project_id=project_id,
                session_id=session_id,
                kind=SessionCommandKind.cancel,
                target_turn_id=target_turn_id,
                expected_turn_id=expected_turn_id,
                state=state,
                outcome=outcome,
                settled_at=received_at if outcome is not None else None,
                idempotency_key=idempotency_key,
                created_at=received_at,
            ),
            stopping_turn_id=stopping_turn_id,
        )

    # -- delivery ----------------------------------------------------------- #

    async def _deliver(self, command: SessionCommand) -> None:
        """Hand the command to the transport, then record what the transport learned.

        Never raises. The user's request has already succeeded by the time this runs.
        """
        command = await self._dao.record_delivery_attempt(
            project_id=command.project_id,
            command_id=command.id,
            now=datetime.now(timezone.utc),
            max_deliveries=env.agenta.sessions.commands.max_deliveries,
        )
        if command is None:
            return

        try:
            receipt = await self._delivery.deliver(command=command)
        except Exception as e:  # noqa: BLE001 — transport failure is never a request failure
            log.warning(
                "control delivery raised for command=%s session=%s: %s",
                command.id,
                command.session_id,
                e,
            )
            return

        if receipt.status == "accepted":
            # Take the claim on the runner's behalf, so the outcome route's guard reads the same
            # way on every transport: only the holder of the claim writes the outcome.
            await self._dao.claim_for_delivery(
                project_id=command.project_id,
                command_id=command.id,
                replica_id=receipt.replica_id or "direct",
                lease_seconds=env.agenta.sessions.commands.lease_seconds,
            )
            return

        if receipt.status == "not_held":
            await self._settle_not_held(command)
            return

        log.warning(
            "control delivery unreachable for command=%s session=%s: %s",
            command.id,
            command.session_id,
            receipt.detail or "no detail",
        )

    async def _settle_not_held(self, command: SessionCommand) -> None:
        """A reachable runner said it does not hold this session. Two different things look
        alike here, and the user must not be told the wrong one.

        `running` is the discriminator, not the heartbeat. A `not_held` while SOME execution
        holds `running` means a process is executing this session and it is not the one we
        called. Settle that `lost`, so the user learns the Stop failed, and log it at error
        level.

        With no `running` execution anywhere, nothing is executing and the work the user meant
        to stop is over. That is the everyday case: the turn ended a moment before the Stop
        arrived, the runner had already dropped it, and the answer is `not_running`. Judging it
        on the heartbeat instead called every one of those a failed Stop, because a turn that
        has just ended leaves `alive` set and a fresh beat behind it, exactly as a running one
        does.
        """
        outcome = SessionCommandOutcome.not_running
        running_owner = await get_running_owner(
            self._lock,
            project_id=str(command.project_id),
            session_id=command.session_id,
        )
        if running_owner is not None and await self._session_is_beating(
            project_id=command.project_id, session_id=command.session_id
        ):
            outcome = SessionCommandOutcome.lost
            # Name the process that DOES hold the session, so the log says where the Stop
            # should have gone rather than only that it did not arrive.
            owner = await get_owner(
                self._lock,
                project_id=str(command.project_id),
                session_id=command.session_id,
            )
            log.error(
                "control delivery: the runner answered not_held for session=%s while "
                "execution %s holds `running` and the row is beating. A process is executing "
                "that session and it is not the one we called, so this deployment has more "
                "than one runner replica and the direct adapter cannot route to it. Settling "
                "the command lost, so the user is told the Stop failed rather than that the "
                "work had already finished. command=%s target_turn=%s owner_replica=%s",
                command.session_id,
                running_owner,
                command.id,
                command.target_turn_id,
                owner or "unknown",
            )
        await self.settle(
            command_id=command.id,
            project_id=command.project_id,
            replica_id=None,
            expected_states=[SessionCommandState.pending],
            state=SessionCommandState.obsolete,
            outcome=outcome,
            execution_id=command.target_turn_id,
        )

    async def _session_is_beating(self, *, project_id: UUID, session_id: str) -> bool:
        """Is a runner process keeping this session's row fresh right now?"""
        stream = await self._streams.fetch_header(
            project_id=project_id, session_id=session_id
        )
        if stream is None or stream.updated_at is None:
            return False
        if not (stream.flags and stream.flags.is_alive):
            return False
        updated_at = stream.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated_at).total_seconds()
        return age < HEARTBEAT_INTERVAL_SECONDS * 2

    async def settle_abandoned_commands(self, *, now: datetime) -> int:
        max_deliveries = env.agenta.sessions.commands.max_deliveries
        abandoned = await self._dao.expire_claims(
            now=now,
            max_deliveries=max_deliveries,
            pending_before=now
            - timedelta(seconds=env.agenta.sessions.commands.admission_timeout_seconds),
        )
        settled = 0
        for command in abandoned:
            beating = await self._session_is_beating(
                project_id=command.project_id,
                session_id=command.session_id,
            )
            if beating and command.claim_count < max_deliveries:
                await self._deliver(command)
                continue

            result = await self.settle(
                command_id=command.id,
                project_id=command.project_id,
                replica_id=None,
                expected_states=[
                    SessionCommandState.pending,
                    SessionCommandState.claimed,
                ],
                state=SessionCommandState.obsolete,
                outcome=SessionCommandOutcome.lost,
                execution_id=command.target_turn_id,
            )
            if result is not None:
                settled += 1
        return settled

    # -- settlement --------------------------------------------------------- #

    async def settle_execution_lost(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        settled_at: datetime,
    ) -> bool:
        if self._executions is None:
            return True
        result = await self._executions.settle(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            terminal_outcome=SessionCommandOutcome.lost.value,
            settled_by="watchdog",
            settled_at=settled_at,
        )
        return result.won

    async def report_outcome(
        self,
        *,
        command_id: UUID,
        replica_id: str,
        result: str,
        execution_id: Optional[str],
        execution_state: str,
        error: Optional[str] = None,
    ) -> SessionCommand:
        """The runner reporting what happened to the execution. Both adapters land here, so
        settlement has one path on every transport."""
        command = await self._dao.fetch_command(command_id=command_id)
        if command is None:
            raise SessionCommandNotFound(command_id=str(command_id))

        outcome = _OUTCOME_BY_EXECUTION_STATE.get(execution_state)
        if outcome is None:
            outcome = SessionCommandOutcome.failed
        state = (
            SessionCommandState.applied
            if result == "applied"
            else SessionCommandState.obsolete
        )
        if error:
            log.warning(
                "session command %s reported a failed cancel for execution=%s: %s",
                command_id,
                execution_id,
                error[:2000],
            )

        settled = await self.settle(
            command_id=command_id,
            project_id=command.project_id,
            replica_id=replica_id,
            # Both, and checked at the moment of the write. Admission inserts `pending`,
            # delivers, and only then writes `claimed` on the runner's behalf, so a runner that
            # aborts fast reports its outcome while the row is still `pending`. Guarding on
            # `claimed` alone refused that report with a conflict and left a correctly stopped
            # execution sitting `claimed` until the sweep called it lost — the user watching
            # "stopping" for the whole sweep window, and a Stop that worked recorded as lost.
            expected_states=[
                SessionCommandState.pending,
                SessionCommandState.claimed,
            ],
            state=state,
            outcome=outcome,
            execution_id=execution_id or command.target_turn_id,
        )
        if settled is None:
            stored = await self._dao.fetch_command(command_id=command_id)
            raise SessionCommandNotClaimable(
                command_id=str(command_id),
                state=stored.state.value if stored else "unknown",
            )
        return settled

    async def settle(
        self,
        *,
        command_id: UUID,
        project_id: UUID,
        replica_id: Optional[str],
        expected_states: List[SessionCommandState],
        state: SessionCommandState,
        outcome: SessionCommandOutcome,
        execution_id: Optional[str],
    ) -> Optional[SessionCommand]:
        """Settle the command and the execution together, guarded on the command's state.

        The guard is what makes this idempotent: a second report finds a terminal row, changes
        nothing, and the side effects below do not run twice.
        """
        if (
            self._executions is not None
            and execution_id is not None
            and outcome in (SessionCommandOutcome.stopped, SessionCommandOutcome.lost)
        ):
            settled_by = (
                "watchdog" if outcome == SessionCommandOutcome.lost else "runner"
            )
            stored_command = await self._dao.fetch_command(command_id=command_id)
            if stored_command is None:
                return None
            execution = await self._executions.settle(
                project_id=project_id,
                session_id=stored_command.session_id,
                execution_id=execution_id,
                terminal_outcome=outcome.value,
                settled_by=settled_by,
            )
            winner = execution.settlement
            if not execution.won and (
                winner.terminal_outcome != outcome.value
                or winner.settled_by != settled_by
            ):
                return None

        settled = await self._dao.settle_command(
            settle=SessionCommandSettle(
                project_id=project_id,
                command_id=command_id,
                state=state,
                outcome=outcome,
                expected_states=expected_states,
                replica_id=replica_id,
            )
        )
        if settled is None:
            return None

        session_id = settled.session_id
        target = settled.target_turn_id

        await self._dao.clear_stopping_turn(
            project_id=project_id,
            session_id=session_id,
            turn_id=target,
        )

        if outcome == SessionCommandOutcome.stopped and target:
            # Order matters. Tombstone first, so a late beat from the stopped execution cannot
            # re-arm the locks it is about to lose; that beat would otherwise find `alive` free
            # and take it straight back under the same turn id.
            await mark_turn_superseded(
                self._lock,
                project_id=str(project_id),
                session_id=session_id,
                turn_id=target,
            )
            # Owner-checked, so it can only release its OWN execution's key.
            await release_running(
                self._lock,
                project_id=str(project_id),
                session_id=session_id,
                turn_id=target,
            )
            # `alive` is deliberately left to its own time to live, exactly as the end of a
            # normal turn leaves it. Warm resume is the required outcome of Stop, so the session
            # must end up in the state a finished turn leaves it in, not in a torn-down one.

            # Mirror the nest onto the row HERE, because nothing else will. The tombstone
            # above refuses the stopped execution's own final `is_running=false` beat before it
            # can reach the heartbeat's mirror write, and the read model the product polls
            # (`query_streams`) reads Postgres and never Redis. Skipping this leaves the row
            # saying `is_running: true` until the orphan sweep collapses it, so the tab that
            # pressed Stop shows a "running somewhere else" strip over its own session.
            await self._streams.mirror_liveness(
                project_id=project_id,
                session_id=session_id,
            )

        if outcome in (
            SessionCommandOutcome.stopped,
            SessionCommandOutcome.not_running,
            SessionCommandOutcome.lost,
        ):
            if target:
                # An approval card whose execution was stopped is a card whose buttons do
                # nothing. Scoped to this execution, so a newer turn's gates survive.
                await self._interactions.cancel_session_pending(
                    project_id=project_id,
                    session_id=session_id,
                    only_turn_id=target,
                )
            await self._streams.publish_session_ended(
                project_id=project_id,
                session_id=session_id,
            )
        return settled


# The runner names what happened to the EXECUTION; the command's `outcome` column stores it.
_OUTCOME_BY_EXECUTION_STATE = {
    "stopped": SessionCommandOutcome.stopped,
    "not_running": SessionCommandOutcome.not_running,
    "superseded_by_newer_turn": SessionCommandOutcome.superseded_by_newer_turn,
    "failed": SessionCommandOutcome.failed,
}

__all__ = [
    "CancelAdmission",
    "SessionCommandsService",
]
