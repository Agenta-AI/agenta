from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text, update as sa_update

from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputCreate
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.dbs.postgres.sessions.inputs.dbes import SessionInputDBE
from oss.src.dbs.postgres.sessions.inputs.mappings import (
    new_input_row,
    to_pending_input,
)
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


class SessionInputsDAO(SessionInputsDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    def transaction(self):
        return self.engine.session()

    async def _lock_session(
        self, session: Any, project_id: UUID, session_id: str
    ) -> None:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
            {"scope": f"{project_id}:{session_id}:inputs"},
        )

    async def create_input(
        self,
        *,
        user_id: Optional[UUID],
        pending_input: PendingInputCreate,
        prioritize: bool = False,
        transaction: Optional[Any] = None,
    ) -> PendingInput:
        async def execute(session: Any) -> PendingInput:
            await self._lock_session(
                session, pending_input.project_id, pending_input.session_id
            )
            # Admission reads before it writes. Two requests carrying the same key can both
            # observe "missing" before either commits, so repeat that lookup after taking the
            # session-scoped transaction lock. Returning the winner lets the service apply the
            # fingerprint rule without leaking an IntegrityError to either caller.
            existing = (
                await session.execute(
                    select(SessionInputDBE).where(
                        SessionInputDBE.project_id == pending_input.project_id,
                        SessionInputDBE.session_id == pending_input.session_id,
                        SessionInputDBE.idempotency_key
                        == pending_input.idempotency_key,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                return to_pending_input(existing)
            aggregate = func.min if prioritize else func.max
            current = (
                await session.execute(
                    select(aggregate(SessionInputDBE.position)).where(
                        SessionInputDBE.project_id == pending_input.project_id,
                        SessionInputDBE.session_id == pending_input.session_id,
                    )
                )
            ).scalar_one()
            position = (
                (current - 1)
                if prioritize and current is not None
                else (current or 0) + 1
            )
            row = new_input_row(
                user_id=user_id,
                position=position,
                values=pending_input.model_dump(mode="python"),
            )
            session.add(row)
            await session.flush()
            return to_pending_input(row)

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
        transaction: Optional[Any] = None,
    ) -> Optional[PendingInput]:
        async def execute(session: Any) -> Optional[PendingInput]:
            row = (
                await session.execute(
                    select(SessionInputDBE).where(
                        SessionInputDBE.project_id == project_id,
                        SessionInputDBE.session_id == session_id,
                        SessionInputDBE.idempotency_key == idempotency_key,
                    )
                )
            ).scalar_one_or_none()
            return to_pending_input(row) if row else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def list_pending(
        self, *, project_id: UUID, session_id: str
    ) -> List[PendingInput]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(SessionInputDBE)
                    .outerjoin(
                        SessionExecutionDBE,
                        and_(
                            SessionExecutionDBE.project_id
                            == SessionInputDBE.project_id,
                            SessionExecutionDBE.session_id
                            == SessionInputDBE.session_id,
                            SessionExecutionDBE.execution_id
                            == SessionInputDBE.promoted_execution_id,
                        ),
                    )
                    .where(
                        SessionInputDBE.project_id == project_id,
                        SessionInputDBE.session_id == session_id,
                        or_(
                            SessionInputDBE.state == "pending",
                            and_(
                                SessionInputDBE.state == "promoted",
                                SessionExecutionDBE.state.in_(
                                    ("pending_delivery", "recoverable")
                                ),
                            ),
                        ),
                    )
                    .order_by(SessionInputDBE.position, SessionInputDBE.created_at)
                )
            ).scalars()
            return [to_pending_input(row) for row in rows]

    async def fetch_input(
        self, *, project_id: UUID, session_id: str, input_id: UUID
    ) -> Optional[PendingInput]:
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    select(SessionInputDBE).where(
                        SessionInputDBE.project_id == project_id,
                        SessionInputDBE.session_id == session_id,
                        SessionInputDBE.id == input_id,
                    )
                )
            ).scalar_one_or_none()
            return to_pending_input(row) if row else None

    async def remove_pending(
        self,
        *,
        project_id: UUID,
        session_id: str,
        input_id: UUID,
        user_id: Optional[UUID],
    ) -> Optional[PendingInput]:
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    sa_update(SessionInputDBE)
                    .where(
                        SessionInputDBE.project_id == project_id,
                        SessionInputDBE.session_id == session_id,
                        SessionInputDBE.id == input_id,
                        SessionInputDBE.state == "pending",
                    )
                    .values(
                        state="removed",
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )
                    .returning(SessionInputDBE)
                )
            ).scalar_one_or_none()
            return to_pending_input(row) if row else None

    async def promote_next(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        input_id: Optional[UUID] = None,
        only_policy: Optional[str] = None,
        transaction: Optional[Any] = None,
    ) -> Optional[PendingInput]:
        async def execute(session: Any) -> Optional[PendingInput]:
            stmt = select(SessionInputDBE).where(
                SessionInputDBE.project_id == project_id,
                SessionInputDBE.session_id == session_id,
                SessionInputDBE.state == "pending",
            )
            if only_policy is not None:
                stmt = stmt.where(SessionInputDBE.policy == only_policy)
            if input_id is not None:
                stmt = stmt.where(SessionInputDBE.id == input_id)
            row = (
                await session.execute(
                    stmt.order_by(SessionInputDBE.position, SessionInputDBE.created_at)
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            row.state = "promoted"
            row.promoted_execution_id = execution_id
            row.updated_at = datetime.now(timezone.utc)
            await session.flush()
            return to_pending_input(row)

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)
