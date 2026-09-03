"""Storage for durable session commands.

Every state transition is one `UPDATE ... WHERE <expected state> RETURNING *`, decided by
`scalar_one_or_none()`. That is what makes two API replicas unable to both win a claim or both
write a terminal outcome, and it is the same pattern
`SessionInteractionsDAO.transition_interaction` already uses.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update as sa_update
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandSettle,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import (
    SessionCommandsDAOInterface,
    SessionScope,
)
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE
from oss.src.dbs.postgres.sessions.commands.mappings import (
    map_command_dbe_to_dto,
    map_command_dto_to_dbe_create,
)
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

_OPEN_STATES = (SessionCommandState.pending.value, SessionCommandState.claimed.value)


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
    ) -> SessionCommand:
        """Insert the command and stamp the session row's `stopping_turn_id` together.

        One transaction, on purpose. A user whose Stop was recorded but whose session row never
        learned it is waiting has a session that renders as plainly running while a command
        exists to stop it, and nothing later reconciles the two.

        `session_streams` is written from here rather than through the streams DAO because
        sharing one transaction is the whole requirement, and the streams DAO opens its own.
        """
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
            return map_command_dbe_to_dto(dbe)
        except IntegrityError:
            # One of two unique constraints refused this insert, and both mean the same thing:
            # a command for this intent already exists. Return it rather than a second command.
            #
            #   uq_session_commands_idempotency  — the caller retried with the same key.
            #   uq_session_commands_open_target  — another request is already stopping this
            #                                      execution, which is what makes two Stops in
            #                                      the SAME INSTANT one command. Admission's own
            #                                      read cannot see a row that has not committed
            #                                      yet, so the database is the decider.
            if command.idempotency_key is not None:
                existing = await self._fetch_by_idempotency_key(
                    project_id=command.project_id,
                    session_id=command.session_id,
                    idempotency_key=command.idempotency_key,
                )
                if existing is not None:
                    return existing
            open_command = await self.fetch_open_command(
                project_id=command.project_id,
                session_id=command.session_id,
                kind=command.kind,
                target_turn_id=command.target_turn_id,
            )
            if open_command is None:
                raise
            return open_command

    async def _fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[SessionCommand]:
        async with self.engine.session() as session:
            stmt = select(SessionCommandDBE).where(
                SessionCommandDBE.project_id == project_id,
                SessionCommandDBE.session_id == session_id,
                SessionCommandDBE.idempotency_key == idempotency_key,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        return map_command_dbe_to_dto(dbe) if dbe is not None else None

    async def fetch_open_command(
        self,
        *,
        project_id: UUID,
        session_id: str,
        kind: SessionCommandKind,
        target_turn_id: Optional[str],
    ) -> Optional[SessionCommand]:
        async with self.engine.session() as session:
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
        return [map_command_dbe_to_dto(dbe) for dbe in claimed]

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
            stmt = stmt.values(
                state=settle.state.value,
                outcome=settle.outcome.value,
                settled_at=now,
                updated_at=now,
            ).returning(SessionCommandDBE)
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
        return [map_command_dbe_to_dto(dbe) for dbe in rows]

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
