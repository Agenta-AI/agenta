"""Storage for durable session commands.

Every state transition is one `UPDATE ... WHERE <expected state> RETURNING *`, decided by
`scalar_one_or_none()`. That is what makes two API replicas unable to both win a claim or both
write a terminal outcome, and it is the same pattern
`SessionInteractionsDAO.transition_interaction` already uses.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update as sa_update
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandSettle,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import (
    CommandCreateResult,
    SessionCommandsDAOInterface,
    SessionScope,
)
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE
from oss.src.dbs.postgres.sessions.commands.mappings import (
    map_command_dbe_to_dto,
    map_command_dto_to_dbe_create,
)
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

log = get_module_logger(__name__)

_OPEN_STATES = (SessionCommandState.pending.value, SessionCommandState.claimed.value)


def _map_commands_skipping_unmappable(
    rows: List[SessionCommandDBE],
    *,
    context: str,
) -> List[SessionCommand]:
    """Map a batch of command rows to DTOs, skipping any row this API cannot map.

    A newer API replica can write a command `kind` (or state, or outcome) an older replica's
    enums do not know; `map_command_dbe_to_dto` then raises `ValueError` on that row. Both the
    abandoned-command sweep and a runner's claim read a whole batch before acting on any of it,
    so one such row used to poison the entire batch -- the ValueError escaped the list
    comprehension and nothing was settled or claimed. Skip the rows this API cannot act on,
    warn once per batch with their kinds and count, and return the rest. The unknown row is
    left untouched for a replica that knows its kind; this never changes the enum or the write
    path. `context` names the batch in the warning (for example "abandoned" or "claimed").
    """
    mapped: List[SessionCommand] = []
    skipped: Dict[str, int] = {}
    for dbe in rows:
        try:
            mapped.append(map_command_dbe_to_dto(dbe))
        except ValueError:
            kind = str(dbe.kind)
            skipped[kind] = skipped.get(kind, 0) + 1
    if skipped:
        by_kind = ", ".join(
            f"{kind}={count}" for kind, count in sorted(skipped.items())
        )
        log.warning(
            "commands: skipped %d %s row(s) this API cannot map (by kind: %s)",
            sum(skipped.values()),
            context,
            by_kind,
        )
    return mapped


class SessionCommandsDAO(SessionCommandsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    def transaction(self):
        return self.engine.session()

    async def create_command(
        self,
        *,
        user_id: Optional[UUID],
        command: SessionCommandCreate,
        stopping_turn_id: Optional[str] = None,
        transaction: Optional[Any] = None,
    ) -> SessionCommand:
        if transaction is None:
            result = await self.create_command_with_status(
                user_id=user_id,
                command=command,
                stopping_turn_id=stopping_turn_id,
            )
            return result.command

        dbe = map_command_dto_to_dbe_create(user_id=user_id, command=command)

        async def execute(session: Any) -> SessionCommand:
            session.add(dbe)
            if stopping_turn_id is not None:
                await session.execute(
                    sa_update(SessionStreamDBE)
                    .where(
                        SessionStreamDBE.project_id == command.project_id,
                        SessionStreamDBE.session_id == command.session_id,
                        SessionStreamDBE.deleted_at.is_(None),
                    )
                    .values(stopping_turn_id=stopping_turn_id)
                )
            await session.flush()
            return map_command_dbe_to_dto(dbe)

        try:
            async with transaction.begin_nested():
                return await execute(transaction)
        except IntegrityError:
            if command.idempotency_key is not None:
                existing = await self.fetch_by_idempotency_key(
                    project_id=command.project_id,
                    session_id=command.session_id,
                    idempotency_key=command.idempotency_key,
                    transaction=transaction,
                )
                if existing is not None:
                    return existing
            open_command = await self.fetch_open_command(
                project_id=command.project_id,
                session_id=command.session_id,
                kind=command.kind,
                target_turn_id=command.target_turn_id,
                transaction=transaction,
            )
            if open_command is None:
                raise
            return open_command

    async def create_command_with_status(
        self,
        *,
        user_id: Optional[UUID],
        command: SessionCommandCreate,
        stopping_turn_id: Optional[str] = None,
    ) -> CommandCreateResult:
        """Insert the command and stamp the session row's status atomically."""
        dbe = map_command_dto_to_dbe_create(user_id=user_id, command=command)

        try:
            async with self.engine.session() as session:
                session.add(dbe)
                if stopping_turn_id is not None:
                    await session.execute(
                        sa_update(SessionStreamDBE)
                        .where(
                            SessionStreamDBE.project_id == command.project_id,
                            SessionStreamDBE.session_id == command.session_id,
                            SessionStreamDBE.deleted_at.is_(None),
                        )
                        .values(stopping_turn_id=stopping_turn_id)
                    )
                await session.commit()
                await session.refresh(dbe)
            return CommandCreateResult(
                command=map_command_dbe_to_dto(dbe), inserted=True
            )
        except IntegrityError:
            if command.idempotency_key is not None:
                existing = await self.fetch_by_idempotency_key(
                    project_id=command.project_id,
                    session_id=command.session_id,
                    idempotency_key=command.idempotency_key,
                )
                if existing is not None:
                    return CommandCreateResult(command=existing, inserted=False)
            open_command = await self.fetch_open_command(
                project_id=command.project_id,
                session_id=command.session_id,
                kind=command.kind,
                target_turn_id=command.target_turn_id,
            )
            if open_command is None:
                raise
            return CommandCreateResult(command=open_command, inserted=False)

    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionCommand]:
        async def execute(session: Any) -> Optional[SessionCommand]:
            stmt = select(SessionCommandDBE).where(
                SessionCommandDBE.project_id == project_id,
                SessionCommandDBE.session_id == session_id,
                SessionCommandDBE.idempotency_key == idempotency_key,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            return map_command_dbe_to_dto(dbe) if dbe is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def fetch_open_command(
        self,
        *,
        project_id: UUID,
        session_id: str,
        kind: SessionCommandKind,
        target_turn_id: Optional[str],
        transaction: Optional[Any] = None,
    ) -> Optional[SessionCommand]:
        async def execute(session: Any) -> Optional[SessionCommand]:
            stmt = (
                select(SessionCommandDBE)
                .where(
                    SessionCommandDBE.project_id == project_id,
                    SessionCommandDBE.session_id == session_id,
                    SessionCommandDBE.kind == kind.value,
                    SessionCommandDBE.state.in_(_OPEN_STATES),
                    SessionCommandDBE.deleted_at.is_(None),
                    (
                        SessionCommandDBE.target_turn_id.is_(None)
                        if target_turn_id is None
                        else SessionCommandDBE.target_turn_id == target_turn_id
                    ),
                )
                .order_by(SessionCommandDBE.created_at.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            return map_command_dbe_to_dto(dbe) if dbe is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def fetch_resumable_continuation(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionCommand]:
        async with self.engine.session() as session:
            stmt = (
                select(SessionCommandDBE)
                .join(
                    SessionExecutionDBE,
                    and_(
                        SessionExecutionDBE.project_id == SessionCommandDBE.project_id,
                        SessionExecutionDBE.session_id == SessionCommandDBE.session_id,
                        SessionExecutionDBE.execution_id
                        == SessionCommandDBE.target_turn_id,
                    ),
                )
                .where(
                    SessionCommandDBE.project_id == project_id,
                    SessionCommandDBE.session_id == session_id,
                    SessionCommandDBE.kind
                    == SessionCommandKind.continue_interaction.value,
                    or_(
                        and_(
                            SessionCommandDBE.state.in_(_OPEN_STATES),
                            SessionExecutionDBE.state.in_(
                                ("pending_delivery", "recoverable")
                            ),
                        ),
                        and_(
                            SessionCommandDBE.state
                            == SessionCommandState.obsolete.value,
                            SessionCommandDBE.outcome.in_(("lost", "failed")),
                            SessionExecutionDBE.state == "recoverable",
                        ),
                        and_(
                            SessionCommandDBE.state
                            == SessionCommandState.applied.value,
                            SessionCommandDBE.outcome == "started",
                            SessionExecutionDBE.state == "recoverable",
                        ),
                    ),
                    SessionCommandDBE.deleted_at.is_(None),
                )
                .order_by(SessionCommandDBE.created_at)
                .limit(1)
            )
            dbe = (await session.execute(stmt)).scalar_one_or_none()
        return map_command_dbe_to_dto(dbe) if dbe is not None else None

    async def reopen_continuation(
        self,
        *,
        project_id: UUID,
        command_id: UUID,
        target_turn_id: str,
        replacement_turn_id: str,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionCommand]:
        async def execute(session: Any) -> Optional[SessionCommand]:
            stmt = (
                sa_update(SessionCommandDBE)
                .where(
                    SessionCommandDBE.project_id == project_id,
                    SessionCommandDBE.id == command_id,
                    SessionCommandDBE.target_turn_id == target_turn_id,
                    SessionCommandDBE.kind
                    == SessionCommandKind.continue_interaction.value,
                    or_(
                        and_(
                            SessionCommandDBE.state
                            == SessionCommandState.obsolete.value,
                            SessionCommandDBE.outcome.in_(("lost", "failed")),
                        ),
                        and_(
                            SessionCommandDBE.state
                            == SessionCommandState.applied.value,
                            SessionCommandDBE.outcome == "started",
                        ),
                    ),
                    select(SessionExecutionDBE.execution_id)
                    .where(
                        SessionExecutionDBE.project_id == SessionCommandDBE.project_id,
                        SessionExecutionDBE.session_id == SessionCommandDBE.session_id,
                        SessionExecutionDBE.execution_id == replacement_turn_id,
                        SessionExecutionDBE.state == "pending_delivery",
                    )
                    .exists(),
                )
                .values(
                    target_turn_id=replacement_turn_id,
                    state=SessionCommandState.pending.value,
                    outcome=None,
                    settled_at=None,
                    claimed_by=None,
                    claim_expires_at=None,
                    claim_count=0,
                    updated_at=datetime.now(timezone.utc),
                )
                .returning(SessionCommandDBE)
            )
            dbe = (await session.execute(stmt)).scalar_one_or_none()
            return map_command_dbe_to_dto(dbe) if dbe is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def fetch_command(
        self,
        *,
        command_id: UUID,
        project_id: Optional[UUID] = None,
    ) -> Optional[SessionCommand]:
        async with self.engine.session() as session:
            stmt = select(SessionCommandDBE).where(
                SessionCommandDBE.id == command_id,
            )
            if project_id is not None:
                stmt = stmt.where(SessionCommandDBE.project_id == project_id)
            result = await session.execute(stmt)
            dbe = result.scalars().first()
        return map_command_dbe_to_dto(dbe) if dbe is not None else None

    async def claim_commands(
        self,
        *,
        sessions: List[SessionScope],
        replica_id: str,
        lease_seconds: int,
        limit: int,
    ) -> List[SessionCommand]:
        """Take pending commands for the sessions the caller declares it holds warm.

        The runner declaring what it holds is the routing input, not a replica id: a parked
        session's Redis owner key expires, but the session is still in the runner's pool.
        """
        if not sessions or limit <= 0:
            return []

        scope_filter = or_(
            *[
                and_(
                    SessionCommandDBE.project_id == scope.project_id,
                    SessionCommandDBE.session_id == scope.session_id,
                )
                for scope in sessions
            ]
        )

        async with self.engine.session() as session:
            selectable = (
                select(SessionCommandDBE.project_id, SessionCommandDBE.id)
                .where(
                    SessionCommandDBE.state == SessionCommandState.pending.value,
                    SessionCommandDBE.deleted_at.is_(None),
                    scope_filter,
                )
                .order_by(SessionCommandDBE.created_at)
                .limit(limit)
                # Two API replicas serving two claims at the same time must neither block on
                # each other nor hand out the same command twice.
                .with_for_update(skip_locked=True)
            )
            rows = (await session.execute(selectable)).all()
            if not rows:
                await session.commit()
                return []

            keys = or_(
                *[
                    and_(
                        SessionCommandDBE.project_id == row[0],
                        SessionCommandDBE.id == row[1],
                    )
                    for row in rows
                ]
            )
            now = datetime.now(timezone.utc)
            stmt = (
                sa_update(SessionCommandDBE)
                .where(
                    keys,
                    SessionCommandDBE.state == SessionCommandState.pending.value,
                )
                .values(
                    state=SessionCommandState.claimed.value,
                    claimed_by=replica_id,
                    claim_expires_at=now + timedelta(seconds=lease_seconds),
                    claim_count=SessionCommandDBE.claim_count + 1,
                    updated_at=now,
                )
                .returning(SessionCommandDBE)
            )
            claimed = (await session.execute(stmt)).scalars().all()
            await session.commit()
        return _map_commands_skipping_unmappable(claimed, context="claimed")

    async def claim_for_delivery(
        self,
        *,
        project_id: UUID,
        command_id: UUID,
        replica_id: str,
        lease_seconds: int,
    ) -> Optional[SessionCommand]:
        """`pending` to `claimed` for one named command, after a runner accepted it directly.

        None means somebody else already took or settled it, which is not an error: the runner
        that answered will still report, and the outcome route decides on the stored state.
        The delivery budget was already consumed by `record_delivery_attempt`; incrementing it
        again here would charge one direct delivery twice. Long-poll claims use `claim_commands`,
        which performs its own increment.
        """
        async with self.engine.session() as session:
            now = datetime.now(timezone.utc)
            stmt = (
                sa_update(SessionCommandDBE)
                .where(
                    SessionCommandDBE.project_id == project_id,
                    SessionCommandDBE.id == command_id,
                    SessionCommandDBE.state == SessionCommandState.pending.value,
                )
                .values(
                    state=SessionCommandState.claimed.value,
                    claimed_by=replica_id,
                    claim_expires_at=now + timedelta(seconds=lease_seconds),
                    updated_at=now,
                )
                .returning(SessionCommandDBE)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            await session.commit()
        return map_command_dbe_to_dto(dbe) if dbe is not None else None

    async def record_delivery_attempt(
        self,
        *,
        project_id: UUID,
        command_id: UUID,
        now: datetime,
        max_deliveries: int,
    ) -> Optional[SessionCommand]:
        stmt = (
            sa_update(SessionCommandDBE)
            .where(
                SessionCommandDBE.project_id == project_id,
                SessionCommandDBE.id == command_id,
                SessionCommandDBE.state.in_(_OPEN_STATES),
                SessionCommandDBE.claim_count < max_deliveries,
                or_(
                    SessionCommandDBE.state == SessionCommandState.pending.value,
                    SessionCommandDBE.claim_expires_at < now,
                ),
            )
            .values(
                state=SessionCommandState.pending.value,
                claimed_by=None,
                claim_expires_at=None,
                claim_count=SessionCommandDBE.claim_count + 1,
                updated_at=now,
            )
            .returning(SessionCommandDBE)
        )
        async with self.engine.session() as session:
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            await session.commit()
        return map_command_dbe_to_dto(dbe) if dbe is not None else None

    async def settle_command(
        self,
        *,
        settle: SessionCommandSettle,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionCommand]:
        """Terminal transition. None means the command was in none of the states the caller
        expected, so the caller reads the stored row and answers 409 instead of letting a runner
        retry.

        One statement, so the guard is evaluated at the moment of the write. Reading the state
        first and updating after would reopen the very race this exists to close: the claim can
        commit between the read and the write.
        """

        async def execute(session: Any) -> Optional[SessionCommand]:
            now = datetime.now(timezone.utc)
            stmt = sa_update(SessionCommandDBE).where(
                SessionCommandDBE.project_id == settle.project_id,
                SessionCommandDBE.id == settle.command_id,
                SessionCommandDBE.state.in_(
                    [state.value for state in settle.expected_states]
                ),
            )
            if settle.replica_id is not None:
                # Only the replica holding the claim may write the outcome. A row still
                # `pending` holds no claim, and refusing it there is what turned a correct
                # abort into a command the sweep later called lost.
                stmt = stmt.where(
                    or_(
                        SessionCommandDBE.claimed_by.is_(None),
                        SessionCommandDBE.claimed_by == settle.replica_id,
                    )
                )
            values = dict(
                state=settle.state.value,
                outcome=settle.outcome.value,
                settled_at=now,
                updated_at=now,
            )
            if settle.replica_id is not None:
                # A pending continuation can report before the API records its delivery claim.
                # Persisting that reporter makes a lost HTTP response retryable by the same
                # runner, while a different replica still receives admitted=false.
                values["claimed_by"] = settle.replica_id
            stmt = stmt.values(**values).returning(SessionCommandDBE)
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            return map_command_dbe_to_dto(dbe) if dbe is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def clear_stopping_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: Optional[str] = None,
    ) -> None:
        async with self.engine.session() as session:
            stmt = (
                sa_update(SessionStreamDBE)
                .where(
                    SessionStreamDBE.project_id == project_id,
                    SessionStreamDBE.session_id == session_id,
                )
                .values(stopping_turn_id=None)
            )
            if turn_id is not None:
                # Only clear OUR marker. A settlement that arrives after a second Stop was
                # admitted must not tell the browser the newer Stop already finished.
                stmt = stmt.where(SessionStreamDBE.stopping_turn_id == turn_id)
            await session.execute(stmt)
            await session.commit()

    async def expire_claims(
        self,
        *,
        now: datetime,
        max_deliveries: int,
        pending_before: Optional[datetime] = None,
    ) -> List[SessionCommand]:
        async with self.engine.session() as session:
            abandoned = and_(
                SessionCommandDBE.state == SessionCommandState.claimed.value,
                SessionCommandDBE.claim_expires_at < now,
            )
            if pending_before is not None:
                abandoned = or_(
                    abandoned,
                    and_(
                        SessionCommandDBE.state == SessionCommandState.pending.value,
                        func.coalesce(
                            SessionCommandDBE.updated_at,
                            SessionCommandDBE.created_at,
                        )
                        < pending_before,
                    ),
                )
            stmt = (
                select(SessionCommandDBE)
                .where(
                    SessionCommandDBE.deleted_at.is_(None),
                    abandoned,
                )
                .order_by(
                    func.coalesce(
                        SessionCommandDBE.claim_expires_at,
                        SessionCommandDBE.updated_at,
                        SessionCommandDBE.created_at,
                    )
                )
                .limit(200)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
        return _map_commands_skipping_unmappable(rows, context="abandoned")

    async def count_open(self, *, project_id: UUID, session_id: str) -> int:
        """Open commands for a session. Diagnostics and tests only."""
        async with self.engine.session() as session:
            stmt = select(func.count()).where(
                SessionCommandDBE.project_id == project_id,
                SessionCommandDBE.session_id == session_id,
                SessionCommandDBE.state.in_(_OPEN_STATES),
                SessionCommandDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
        return int(result.scalar() or 0)
