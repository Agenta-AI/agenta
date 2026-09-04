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
from typing import Any, List, Optional, Tuple
from uuid import UUID, uuid4

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandSettle,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import (
    CommandCreateResult,
    ControlDeliveryPort,
    DeliveryReceipt,
    SessionCommandsDAOInterface,
)
from oss.src.core.sessions.commands.types import (
    ExecutionExpectationFailed,
    SessionCommandIdempotencyConflict,
    IdempotencyKeyReused,
    InteractionResponseConflict,
    SessionCommandNotClaimable,
    SessionCommandNotFound,
)
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.streams.dtos import (
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionIdInvalid, SessionTurnMismatch
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    HEARTBEAT_INTERVAL_SECONDS,
    validate_session_id,
)
from oss.src.dbs.redis.sessions.locks import (
    get_alive_owner,
    get_owner,
    get_running_owner,
    reconcile_stopped_turn,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class _ContinuationReopenLost(Exception):
    """The durable command changed while a fresh recovery attempt was being created."""


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


class InteractionContinuationAdmission:
    def __init__(
        self,
        *,
        interaction: SessionInteraction,
        command: SessionCommand,
        execution_id: str,
        execution_state: SessionExecutionState = SessionExecutionState.pending_delivery,
    ) -> None:
        self.interaction = interaction
        self.command = command
        self.execution_id = execution_id
        self.execution_state = execution_state


class CommandOutcomeReport:
    def __init__(self, *, command: SessionCommand, admitted: bool) -> None:
        self.command = command
        self.admitted = admitted


class _SettlementRejected(Exception):
    pass


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
        expected_execution_id: Optional[str] = None,
    ) -> SessionStreamCommandResponse:
        """Use the heartbeat-carried Stop path kept for rollout rollback."""
        try:
            return await self._streams.command(
                project_id=project_id,
                user_id=user_id,
                request=SessionStreamCommandRequest(
                    session_id=session_id,
                    expected_execution_id=expected_execution_id,
                ),
            )
        except SessionTurnMismatch as error:
            raise ExecutionExpectationFailed(
                expected=error.expected_turn_id,
                current=error.actual_turn_id,
            ) from error

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

        if idempotency_key is not None:
            existing = await self._dao.fetch_by_idempotency_key(
                project_id=project_id,
                session_id=session_id,
                idempotency_key=idempotency_key,
            )
            if existing is not None:
                if existing.expected_turn_id != expected_execution_id:
                    raise SessionCommandIdempotencyConflict(
                        idempotency_key=idempotency_key
                    )
                return self._admission_for_existing(existing)

        target_turn_id, turn_started_at = await self._resolve_target(
            project_id=project_id,
            session_id=session_id,
            expected_turn_id=expected_execution_id,
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
            # No eligible execution is running. Record the intent so a retry with the same key
            # gets the same answer, and settle it in the same write.
            created = await self._insert(
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
            if not created.inserted:
                return self._admission_for_existing(created.command)
            command = created.command
            return CancelAdmission(command=command, execution_id=None, accepted=False)

        if (
            expected_execution_id is None
            and turn_started_at is not None
            and turn_started_at > received_at
        ):
            # The execution now running began AFTER the user pressed Stop, so it is not the one
            # they meant. Do not target it, do not touch Redis, and tell the caller there is
            # nothing of theirs left to stop.
            created = await self._insert(
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
            if not created.inserted:
                return self._admission_for_existing(created.command)
            command = created.command
            return CancelAdmission(command=command, execution_id=None, accepted=False)

        open_command = await self._dao.fetch_open_command(
            project_id=project_id,
            session_id=session_id,
            kind=SessionCommandKind.cancel,
            target_turn_id=target_turn_id,
        )
        if open_command is not None:
            if open_command.state == SessionCommandState.pending:
                await self._deliver(open_command)
            return CancelAdmission(
                command=open_command,
                execution_id=target_turn_id,
                accepted=True,
            )

        if self._executions is None or not hasattr(
            self._executions, "lock_for_control"
        ):
            created = await self._insert(
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
            if not created.inserted:
                return self._admission_for_existing(created.command)
            command = created.command
        else:
            cancelled_interactions = 0
            async with self._dao.transaction() as transaction:
                execution = await self._executions.lock_for_control(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=target_turn_id,
                    transaction=transaction,
                )
                if execution.terminal_outcome is not None:
                    raise ExecutionExpectationFailed(
                        expected=expected_execution_id or target_turn_id,
                        current=None,
                    )
                open_command = await self._dao.fetch_open_command(
                    project_id=project_id,
                    session_id=session_id,
                    kind=SessionCommandKind.cancel,
                    target_turn_id=target_turn_id,
                    transaction=transaction,
                )
                if open_command is not None:
                    command = open_command
                else:
                    await self._executions.set_state(
                        project_id=project_id,
                        session_id=session_id,
                        execution_id=target_turn_id,
                        state=SessionExecutionState.stopping,
                        transaction=transaction,
                    )
                    created = await self._insert(
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
                        transaction=transaction,
                    )
                    command = created.command
                    cancelled_interactions = (
                        await self._interactions.cancel_session_pending(
                            project_id=project_id,
                            session_id=session_id,
                            only_turn_id=target_turn_id,
                            transaction=transaction,
                            publish=False,
                        )
                    )
            if cancelled_interactions:
                await self._interactions.publish_session_pending_cancelled(
                    project_id=project_id, session_id=session_id
                )
        # The row is committed. Everything from here is promptness, not correctness.
        if command.state == SessionCommandState.pending:
            await self._deliver(command)
        return CancelAdmission(
            command=command, execution_id=target_turn_id, accepted=True
        )

    async def respond_interaction(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        interaction_id: UUID,
        answer: dict[str, Any],
        expected_execution_id: Optional[str],
        idempotency_key: str,
    ) -> InteractionContinuationAdmission:
        if self._executions is None:
            raise RuntimeError(
                "durable interaction responses require executions storage"
            )

        async with self._dao.transaction() as transaction:
            interaction = await self._interactions.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
                transaction=transaction,
            )
            source_execution_id = interaction.turn_id
            if source_execution_id is None:
                raise InteractionResponseConflict(
                    code="validation_error",
                    message="The interaction is not linked to an execution.",
                )
            if (
                expected_execution_id is not None
                and expected_execution_id != source_execution_id
            ):
                raise InteractionResponseConflict(
                    code="execution_mismatch",
                    message="The interaction belongs to a different execution.",
                    details={"current_execution_id": source_execution_id},
                )

            source = await self._executions.lock_for_control(
                project_id=project_id,
                session_id=interaction.session_id,
                execution_id=source_execution_id,
                transaction=transaction,
            )
            interaction = await self._interactions.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
                transaction=transaction,
                for_update=True,
            )
            existing = await self._dao.fetch_by_idempotency_key(
                project_id=project_id,
                session_id=interaction.session_id,
                idempotency_key=idempotency_key,
                transaction=transaction,
            )
            if existing is not None:
                same_request = (
                    existing.kind == SessionCommandKind.continue_interaction
                    and existing.expected_turn_id == source_execution_id
                    and existing.data is not None
                    and existing.data.get("interaction_id") == str(interaction_id)
                    and interaction.data is not None
                    and interaction.data.resolution == answer
                )
                if not same_request:
                    raise IdempotencyKeyReused()
                execution_id = str(existing.data["continuation_execution_id"])
                admission = InteractionContinuationAdmission(
                    interaction=interaction,
                    command=existing,
                    execution_id=execution_id,
                )
            else:
                if interaction.status != SessionInteractionStatus.pending:
                    raise InteractionResponseConflict(
                        code="execution_terminal",
                        message="The interaction is no longer pending.",
                        details={
                            "interaction_status": (
                                interaction.status.value
                                if interaction.status is not None
                                else None
                            )
                        },
                    )
                if source.terminal_outcome is not None or source.state in (
                    SessionExecutionState.stopping,
                    SessionExecutionState.terminal,
                ):
                    raise InteractionResponseConflict(
                        code="execution_terminal",
                        message="The source execution can no longer be continued.",
                        details={"execution_state": source.state.value},
                    )

                transitioned = await self._interactions.transition_interaction(
                    transition=SessionInteractionTransition(
                        project_id=project_id,
                        session_id=interaction.session_id,
                        token=interaction.token,
                        status=SessionInteractionStatus.responded,
                        resolution=answer,
                    ),
                    transaction=transaction,
                    publish=False,
                )
                result = await self._executions.settle(
                    project_id=project_id,
                    session_id=interaction.session_id,
                    execution_id=source_execution_id,
                    terminal_outcome="continued",
                    settled_by="interaction_response",
                    transaction=transaction,
                )
                if not result.won:
                    raise InteractionResponseConflict(
                        code="execution_terminal",
                        message="The source execution can no longer be continued.",
                        details={
                            "terminal_outcome": result.settlement.terminal_outcome
                        },
                    )

                execution_id = str(uuid4())
                await self._executions.create_continuation(
                    project_id=project_id,
                    session_id=interaction.session_id,
                    execution_id=execution_id,
                    parent_execution_id=source_execution_id,
                    source_interaction_id=interaction_id,
                    transaction=transaction,
                )
                command = await self._dao.create_command(
                    user_id=user_id,
                    command=SessionCommandCreate(
                        project_id=project_id,
                        session_id=interaction.session_id,
                        kind=SessionCommandKind.continue_interaction,
                        target_turn_id=execution_id,
                        expected_turn_id=source_execution_id,
                        data={
                            "interaction_id": str(interaction_id),
                            "continuation_execution_id": execution_id,
                        },
                        idempotency_key=idempotency_key,
                    ),
                    transaction=transaction,
                )
                if (
                    command.kind != SessionCommandKind.continue_interaction
                    or command.target_turn_id != execution_id
                    or command.data is None
                    or command.data.get("interaction_id") != str(interaction_id)
                ):
                    raise IdempotencyKeyReused()
                admission = InteractionContinuationAdmission(
                    interaction=transitioned,
                    command=command,
                    execution_id=execution_id,
                )

        try:
            await self._interactions.publish_interaction_responded(
                project_id=project_id,
                session_id=admission.interaction.session_id,
            )
        except Exception as error:  # noqa: BLE001 - the durable transaction already committed
            log.warning(
                "interaction response watch publish failed interaction=%s: %s",
                interaction_id,
                error,
            )
        if admission.command.state == SessionCommandState.pending:
            try:
                receipt = await self._deliver(admission.command)
            except Exception as error:  # noqa: BLE001 - admission remains accepted
                log.warning(
                    "continuation post-commit delivery failed command=%s: %s",
                    admission.command.id,
                    error,
                )
                receipt = None
            if receipt is None or receipt.status != "accepted":
                await self._mark_continuation_recoverable(admission)
                admission.execution_state = SessionExecutionState.recoverable
        return admission

    async def _mark_continuation_recoverable(
        self, admission: InteractionContinuationAdmission
    ) -> None:
        if self._executions is None:
            return
        try:
            await self._executions.set_state(
                project_id=admission.command.project_id,
                session_id=admission.command.session_id,
                execution_id=admission.execution_id,
                state=SessionExecutionState.recoverable,
                error={
                    "code": "continuation_delivery_failed",
                    "retryable": True,
                    "message": "The continuation is durable and awaiting redelivery.",
                },
            )
        except Exception as error:  # noqa: BLE001 - recovery projection is best effort
            log.error(
                "continuation recoverable projection failed command=%s execution=%s: %s",
                admission.command.id,
                admission.execution_id,
                error,
            )

    async def resume_recoverable_continuation(
        self, *, project_id: UUID, session_id: str
    ) -> bool:
        if not env.agenta.sessions.durable_stop:
            return False
        command = await self._dao.fetch_resumable_continuation(
            project_id=project_id,
            session_id=session_id,
        )
        if command is None:
            return False
        execution_id = command.target_turn_id
        if execution_id is None or self._executions is None:
            return True
        execution = await self._executions.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )
        if execution is None:
            return True
        if execution.state == SessionExecutionState.running:
            # A stale heartbeat is not a fencing token: a partitioned runner can still be
            # executing the approved side effect. Only the watchdog may turn `running` into
            # `recoverable`, after it has collapsed and tombstoned the old ownership. Until
            # then this durable continuation still owns Send, but it is never redelivered.
            return True
        if command.state not in (
            SessionCommandState.pending,
            SessionCommandState.claimed,
        ):
            command = await self._reopen_continuation_attempt(
                project_id=project_id,
                session_id=session_id,
                command=command,
                execution=execution,
            )
            if command is None:
                return True
            execution_id = command.target_turn_id
            if execution_id is None:
                return True
        admission = InteractionContinuationAdmission(
            interaction=await self._interaction_for_command(command),
            command=command,
            execution_id=execution_id,
            execution_state=SessionExecutionState.recoverable,
        )
        try:
            receipt = await self._deliver(command)
        except Exception as error:  # noqa: BLE001 - keep ownership with the durable continuation
            log.warning(
                "continuation resume delivery failed command=%s: %s", command.id, error
            )
            receipt = None
        if receipt is None or receipt.status != "accepted":
            await self._mark_continuation_recoverable(admission)
        return True

    async def _reopen_continuation_attempt(
        self,
        *,
        project_id: UUID,
        session_id: str,
        command: SessionCommand,
        execution: Any,
    ) -> Optional[SessionCommand]:
        """Fence a tombstoned attempt and retarget its command in one transaction."""
        if (
            self._executions is None
            or execution.state != SessionExecutionState.recoverable
        ):
            return None
        data = command.data or {}
        root_execution_id = data.get("continuation_execution_id")
        if not isinstance(root_execution_id, str) or not root_execution_id:
            return None
        replacement_execution_id = str(uuid4())
        try:
            async with self._dao.transaction() as transaction:
                stored = await self._executions.lock_for_control(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=execution.execution_id,
                    transaction=transaction,
                )
                if (
                    stored.state != SessionExecutionState.recoverable
                    or stored.terminal_outcome is not None
                ):
                    return None
                settled = await self._executions.settle(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=stored.execution_id,
                    terminal_outcome=SessionCommandOutcome.lost.value,
                    settled_by="watchdog",
                    transaction=transaction,
                )
                if not settled.won:
                    return None
                await self._executions.create_continuation(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=replacement_execution_id,
                    parent_execution_id=root_execution_id,
                    source_interaction_id=None,
                    transaction=transaction,
                )
                reopened = await self._dao.reopen_continuation(
                    project_id=project_id,
                    command_id=command.id,
                    target_turn_id=stored.execution_id,
                    replacement_turn_id=replacement_execution_id,
                    transaction=transaction,
                )
                if reopened is None:
                    raise _ContinuationReopenLost
                return reopened
        except _ContinuationReopenLost:
            return None

    async def _resolve_target(
        self,
        *,
        project_id: UUID,
        session_id: str,
        expected_turn_id: Optional[str],
    ) -> Tuple[Optional[str], Optional[datetime]]:
        """The execution to stop, and when it started.

        An unfenced Stop targets only `running`. A named Stop may fall back to `alive` so it can
        still reach the parked approval the caller observed.
        """
        turn_id = await get_running_owner(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        if turn_id is None and expected_turn_id is not None:
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
        transaction: Optional[Any] = None,
    ) -> CommandCreateResult:
        if transaction is not None:
            command = await self._dao.create_command(
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
                transaction=transaction,
            )
            return CommandCreateResult(command=command, inserted=True)
        return await self._dao.create_command_with_status(
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

    @staticmethod
    def _admission_for_existing(command: SessionCommand) -> CancelAdmission:
        """Replay the command's original target without delivering it again."""
        return CancelAdmission(
            command=command,
            execution_id=command.target_turn_id,
            accepted=command.target_turn_id is not None,
        )

    # -- delivery ----------------------------------------------------------- #

    async def _deliver(self, command: SessionCommand) -> Optional[DeliveryReceipt]:
        """Hand the command to the transport, then record what the transport learned.

        Never raises. The user's request has already succeeded by the time this runs.
        """
        try:
            command = await self._dao.record_delivery_attempt(
                project_id=command.project_id,
                command_id=command.id,
                now=datetime.now(timezone.utc),
                max_deliveries=env.agenta.sessions.commands.max_deliveries,
            )
        except Exception as error:  # noqa: BLE001 - delivery bookkeeping is post-commit
            log.warning("control delivery reservation failed: %s", error)
            return None
        if command is None:
            return None

        try:
            command = await self._command_for_delivery(command)
        except Exception as error:  # noqa: BLE001 - a later sweep or Send can retry
            log.warning(
                "control delivery hydration failed command=%s: %s", command.id, error
            )
            return DeliveryReceipt(status="unreachable", detail=str(error))

        try:
            receipt = await self._delivery.deliver(command=command)
        except Exception as e:  # noqa: BLE001 — transport failure is never a request failure
            log.warning(
                "control delivery raised for command=%s session=%s: %s",
                command.id,
                command.session_id,
                e,
            )
            return DeliveryReceipt(status="unreachable", detail=str(e))

        if receipt.status == "accepted":
            # Take the claim on the runner's behalf, so the outcome route's guard reads the same
            # way on every transport: only the holder of the claim writes the outcome.
            try:
                await self._dao.claim_for_delivery(
                    project_id=command.project_id,
                    command_id=command.id,
                    replica_id=receipt.replica_id or "direct",
                    lease_seconds=env.agenta.sessions.commands.lease_seconds,
                )
            except Exception as error:  # noqa: BLE001 - runner outcome still owns settlement
                log.warning(
                    "control delivery claim projection failed command=%s: %s",
                    command.id,
                    error,
                )
            return receipt

        if receipt.status == "not_held":
            if command.kind == SessionCommandKind.continue_interaction:
                return receipt
            await self._settle_not_held(command)
            return receipt

        log.warning(
            "control delivery unreachable for command=%s session=%s: %s",
            command.id,
            command.session_id,
            receipt.detail or "no detail",
        )
        return receipt

    async def _interaction_for_command(
        self, command: SessionCommand
    ) -> SessionInteraction:
        interaction_id = (command.data or {}).get("interaction_id")
        if not isinstance(interaction_id, str):
            raise ValueError("continuation command has no interaction id")
        return await self._interactions.fetch_interaction(
            project_id=command.project_id,
            interaction_id=UUID(interaction_id),
        )

    async def _command_for_delivery(self, command: SessionCommand) -> SessionCommand:
        if command.kind != SessionCommandKind.continue_interaction:
            return command
        interaction = await self._interaction_for_command(command)
        if interaction.data is None or interaction.data.resolution is None:
            raise ValueError("continuation interaction has no durable resolution")
        return command.model_copy(
            update={
                "data": {
                    **(command.data or {}),
                    "answer": interaction.data.resolution,
                }
            }
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
            if command.kind == SessionCommandKind.continue_interaction:
                if not env.agenta.sessions.durable_stop:
                    continue
                if command.claim_count < max_deliveries:
                    await self._deliver(command)
                    continue
                result = await self._settle_exhausted_continuation(command)
                if result:
                    settled += 1
                continue
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

    async def _settle_exhausted_continuation(self, command: SessionCommand) -> bool:
        transition = SessionCommandSettle(
            project_id=command.project_id,
            command_id=command.id,
            state=SessionCommandState.obsolete,
            outcome=SessionCommandOutcome.lost,
            expected_states=[SessionCommandState.pending, SessionCommandState.claimed],
        )
        async with self._dao.transaction() as transaction:
            settled = await self._dao.settle_command(
                settle=transition, transaction=transaction
            )
            if settled is None:
                return False
            if self._executions is not None and command.target_turn_id is not None:
                await self._executions.set_state(
                    project_id=command.project_id,
                    session_id=command.session_id,
                    execution_id=command.target_turn_id,
                    state=SessionExecutionState.recoverable,
                    error={
                        "code": "continuation_delivery_exhausted",
                        "message": "Continuation delivery exhausted its automatic retry budget.",
                        "retryable": True,
                    },
                    transaction=transaction,
                )
        return True

    # -- settlement --------------------------------------------------------- #

    async def settle_execution_lost(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        settled_at: datetime,
        transaction: Optional[Any] = None,
    ) -> bool:
        if self._executions is None:
            return True
        execution = await self._executions.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )
        if (
            execution is not None
            and (
                execution.source_interaction_id is not None
                or execution.parent_execution_id is not None
            )
            and execution.terminal_outcome is None
        ):
            recovered = await self._executions.set_state(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
                state=SessionExecutionState.recoverable,
                error={
                    "code": "continuation_execution_lost",
                    "message": "The continuation runner disappeared before completion.",
                    "retryable": True,
                },
                expected_states=[
                    SessionExecutionState.pending_delivery,
                    SessionExecutionState.running,
                ],
            )
            if recovered is not None:
                return False
            # A recoverable continuation deliberately receives no watchdog terminal record.
            # Its next delivery resumes the same logical execution. A concurrent terminal
            # winner likewise already owns the ending, so neither race permits a lost record.
            return False
        result = await self._executions.settle(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            terminal_outcome=SessionCommandOutcome.lost.value,
            settled_by="watchdog",
            settled_at=settled_at,
            transaction=transaction,
        )
        winner = result.settlement
        return result.won or (
            winner.terminal_outcome == SessionCommandOutcome.lost.value
            and winner.settled_by == "watchdog"
        )

    async def settle_execution_completed(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> bool:
        """Reconcile a persisted runner ending before stale ownership is collapsed."""
        if self._executions is None:
            return True
        execution = await self._executions.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )
        if execution is None or (
            execution.source_interaction_id is None
            and execution.parent_execution_id is None
        ):
            return True
        if execution.terminal_outcome is not None:
            return True
        result = await self._executions.settle(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            terminal_outcome="completed",
            settled_by="runner",
        )
        return result.won or result.settlement.terminal_outcome is not None

    async def repair_terminal_redis(self) -> int:
        if self._executions is None:
            return 0
        misses = await self._executions.list_redis_unreconciled(limit=200)
        repaired = 0
        for execution in misses:
            await self._reconcile_stopped_redis(
                project_id=execution.project_id,
                session_id=execution.session_id,
                execution_id=execution.execution_id,
            )
            repaired += 1
        return repaired

    async def _reconcile_stopped_redis(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> None:
        await reconcile_stopped_turn(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            turn_id=execution_id,
        )
        if self._executions is not None:
            await self._executions.mark_redis_reconciled(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )

    async def report_outcome(
        self,
        *,
        command_id: UUID,
        replica_id: str,
        result: str,
        execution_id: Optional[str],
        execution_state: str,
        error: Optional[str] = None,
    ) -> CommandOutcomeReport:
        """The runner reporting what happened to the execution. Both adapters land here, so
        settlement has one path on every transport."""
        command = await self._dao.fetch_command(command_id=command_id)
        if command is None:
            raise SessionCommandNotFound(command_id=str(command_id))

        if command.kind == SessionCommandKind.continue_interaction:
            return await self._report_continuation_outcome(
                command=command,
                replica_id=replica_id,
                result=result,
                execution_id=execution_id,
                execution_state=execution_state,
                error=error,
            )

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
        return CommandOutcomeReport(command=settled, admitted=True)

    async def _report_continuation_outcome(
        self,
        *,
        command: SessionCommand,
        replica_id: str,
        result: str,
        execution_id: Optional[str],
        execution_state: str,
        error: Optional[str],
    ) -> CommandOutcomeReport:
        target = execution_id or command.target_turn_id
        if target is None or target != command.target_turn_id:
            raise SessionCommandNotClaimable(
                command_id=str(command.id), state="execution_mismatch"
            )
        if (
            command.state == SessionCommandState.applied
            and command.outcome == SessionCommandOutcome.started
        ):
            return await self._readmit_recoverable_continuation(
                command=command,
                replica_id=replica_id,
                execution_id=target,
            )
        started = result == "applied" and execution_state == "started"
        settle = SessionCommandSettle(
            project_id=command.project_id,
            command_id=command.id,
            state=(
                SessionCommandState.applied if started else SessionCommandState.obsolete
            ),
            outcome=(
                SessionCommandOutcome.started
                if started
                else SessionCommandOutcome.failed
            ),
            expected_states=[SessionCommandState.pending, SessionCommandState.claimed],
            replica_id=replica_id,
        )
        execution_blocked = False
        async with self._dao.transaction() as transaction:
            execution = await self._executions.lock_for_control(
                project_id=command.project_id,
                session_id=command.session_id,
                execution_id=target,
                transaction=transaction,
            )
            execution_blocked = (
                execution.terminal_outcome is not None
                or execution.state
                not in (
                    SessionExecutionState.pending_delivery,
                    SessionExecutionState.recoverable,
                )
            )
            stored = None
            if not execution_blocked:
                stored = await self._dao.settle_command(
                    settle=settle, transaction=transaction
                )
            if stored is not None:
                transitioned = await self._executions.set_state(
                    project_id=command.project_id,
                    session_id=command.session_id,
                    execution_id=target,
                    state=(
                        SessionExecutionState.running
                        if started
                        else SessionExecutionState.recoverable
                    ),
                    error=(
                        None
                        if started
                        else {
                            "code": "continuation_start_failed",
                            "message": error or "The runner rejected the continuation.",
                            "retryable": True,
                        }
                    ),
                    expected_states=[execution.state],
                    transaction=transaction,
                )
                if transitioned is None:
                    raise RuntimeError(
                        "continuation execution changed while its control lock was held"
                    )
        if execution_blocked:
            return CommandOutcomeReport(command=command, admitted=False)
        if stored is None:
            latest = await self._dao.fetch_command(command_id=command.id)
            if (
                latest is not None
                and latest.state == SessionCommandState.applied
                and latest.outcome == SessionCommandOutcome.started
            ):
                return await self._readmit_recoverable_continuation(
                    command=latest,
                    replica_id=replica_id,
                    execution_id=target,
                )
            raise SessionCommandNotClaimable(
                command_id=str(command.id),
                state=latest.state.value if latest else command.state.value,
            )
        return CommandOutcomeReport(command=stored, admitted=True)

    async def _readmit_recoverable_continuation(
        self,
        *,
        command: SessionCommand,
        replica_id: str,
        execution_id: str,
    ) -> CommandOutcomeReport:
        if command.claimed_by != replica_id or self._executions is None:
            return CommandOutcomeReport(command=command, admitted=False)
        transitioned = await self._executions.set_state(
            project_id=command.project_id,
            session_id=command.session_id,
            execution_id=execution_id,
            state=SessionExecutionState.running,
            error=None,
            expected_states=[SessionExecutionState.recoverable],
        )
        return CommandOutcomeReport(
            command=command,
            admitted=transitioned is not None,
        )

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
        transition = SessionCommandSettle(
            project_id=project_id,
            command_id=command_id,
            state=state,
            outcome=outcome,
            expected_states=expected_states,
            replica_id=replica_id,
        )
        atomic_core_settlement = self._executions is not None
        cancelled_interactions = 0
        if atomic_core_settlement:
            stored_command = await self._dao.fetch_command(command_id=command_id)
            if stored_command is None:
                return None
            terminal = outcome in (
                SessionCommandOutcome.stopped,
                SessionCommandOutcome.not_running,
                SessionCommandOutcome.lost,
            )
            settled_by = (
                "watchdog"
                if outcome == SessionCommandOutcome.lost
                else "runner"
                if terminal
                else None
            )
            try:
                async with self._dao.transaction() as transaction:
                    settled = await self._dao.settle_command(
                        settle=transition,
                        transaction=transaction,
                    )
                    if settled is None:
                        raise _SettlementRejected

                    if execution_id and terminal and settled_by:
                        result = await self._executions.settle(
                            project_id=project_id,
                            session_id=stored_command.session_id,
                            execution_id=execution_id,
                            terminal_outcome=outcome.value,
                            settled_by=settled_by,
                            transaction=transaction,
                        )
                        winner = result.settlement
                        if not result.won and (
                            winner.terminal_outcome != outcome.value
                            or winner.settled_by != settled_by
                        ):
                            raise _SettlementRejected

                    await self._streams.settle_command(
                        project_id=project_id,
                        session_id=stored_command.session_id,
                        turn_id=execution_id,
                        mirror_stopped=outcome == SessionCommandOutcome.stopped,
                        transaction=transaction,
                    )
                    if execution_id and outcome in (
                        SessionCommandOutcome.stopped,
                        SessionCommandOutcome.not_running,
                        SessionCommandOutcome.lost,
                    ):
                        cancelled_interactions = (
                            await self._interactions.cancel_session_pending(
                                project_id=project_id,
                                session_id=stored_command.session_id,
                                only_turn_id=execution_id,
                                transaction=transaction,
                                publish=False,
                            )
                        )
            except _SettlementRejected:
                return None
        else:
            settled = await self._dao.settle_command(settle=transition)
        if settled is None:
            return None

        session_id = settled.session_id
        target = settled.target_turn_id

        if cancelled_interactions:
            await self._interactions.publish_session_pending_cancelled(
                project_id=project_id,
                session_id=session_id,
            )

        if not atomic_core_settlement:
            await self._dao.clear_stopping_turn(
                project_id=project_id,
                session_id=session_id,
                turn_id=target,
            )

        if outcome == SessionCommandOutcome.stopped and target:
            # Order matters. Tombstone first, so a late beat from the stopped execution cannot
            # re-arm the locks it is about to lose; that beat would otherwise find `alive` free
            # and take it straight back under the same turn id.
            await self._reconcile_stopped_redis(
                project_id=project_id,
                session_id=session_id,
                execution_id=target,
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
            if not atomic_core_settlement:
                await self._streams.mirror_liveness(
                    project_id=project_id,
                    session_id=session_id,
                )

        if outcome in (
            SessionCommandOutcome.stopped,
            SessionCommandOutcome.not_running,
            SessionCommandOutcome.lost,
        ):
            if target and not atomic_core_settlement:
                # An approval card whose execution was stopped is a card whose buttons do
                # nothing. Scoped to this execution, so a newer turn's gates survive.
                await self._interactions.cancel_session_pending(
                    project_id=project_id,
                    session_id=session_id,
                    only_turn_id=target,
                    command_id=command_id,
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
    "InteractionContinuationAdmission",
    "SessionCommandsService",
]
