from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import and_, or_, select, tuple_, update as sa_update
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.sessions.executions.dtos import (
    SessionExecutionState,
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


def _to_dto(row: SessionExecutionDBE) -> SessionExecutionSettlement:
    return SessionExecutionSettlement(
        project_id=row.project_id,
        session_id=row.session_id,
        execution_id=row.execution_id,
        state=SessionExecutionState(row.state),
        parent_execution_id=row.parent_execution_id,
        source_interaction_id=row.source_interaction_id,
        error=row.error,
        terminal_outcome=row.terminal_outcome,
        settled_by=row.settled_by,
        settled_at=row.settled_at,
        ending_written_at=row.ending_written_at,
        redis_reconciled_at=row.redis_reconciled_at,
    )


class SessionExecutionsDAO(SessionExecutionsDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    async def fetch_execution(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionExecutionSettlement]:
        async def execute(session: Any) -> Optional[SessionExecutionSettlement]:
            row = (
                await session.execute(
                    select(SessionExecutionDBE).where(
                        SessionExecutionDBE.project_id == project_id,
                        SessionExecutionDBE.session_id == session_id,
                        SessionExecutionDBE.execution_id == execution_id,
                    )
                )
            ).scalar_one_or_none()
            return _to_dto(row) if row is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def lock_for_control(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        transaction: Any,
    ) -> SessionExecutionSettlement:
        await transaction.execute(
            insert(SessionExecutionDBE)
            .values(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
                state=SessionExecutionState.active.value,
            )
            .on_conflict_do_nothing(
                index_elements=["project_id", "session_id", "execution_id"]
            )
        )
        row = (
            await transaction.execute(
                select(SessionExecutionDBE)
                .where(
                    SessionExecutionDBE.project_id == project_id,
                    SessionExecutionDBE.session_id == session_id,
                    SessionExecutionDBE.execution_id == execution_id,
                )
                .with_for_update()
            )
        ).scalar_one()
        return _to_dto(row)

    async def create_continuation(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        parent_execution_id: str,
        source_interaction_id: Optional[UUID],
        transaction: Any,
    ) -> SessionExecutionSettlement:
        row = SessionExecutionDBE(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            state=SessionExecutionState.pending_delivery.value,
            parent_execution_id=parent_execution_id,
            source_interaction_id=source_interaction_id,
        )
        transaction.add(row)
        await transaction.flush()
        return _to_dto(row)

    async def set_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        state: SessionExecutionState,
        error: Optional[dict] = None,
        expected_states: Optional[Sequence[SessionExecutionState]] = None,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionExecutionSettlement]:
        async def execute(session: Any) -> Optional[SessionExecutionSettlement]:
            stmt = sa_update(SessionExecutionDBE).where(
                SessionExecutionDBE.project_id == project_id,
                SessionExecutionDBE.session_id == session_id,
                SessionExecutionDBE.execution_id == execution_id,
                SessionExecutionDBE.terminal_outcome.is_(None),
            )
            if expected_states is not None:
                stmt = stmt.where(
                    SessionExecutionDBE.state.in_(
                        [expected.value for expected in expected_states]
                    )
                )
            row = (
                await session.execute(
                    stmt.values(state=state.value, error=error).returning(
                        SessionExecutionDBE
                    )
                )
            ).scalar_one_or_none()
            return _to_dto(row) if row is not None else None

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def settle(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        terminal_outcome: str,
        settled_by: str,
        settled_at: Optional[datetime] = None,
        transaction: Optional[Any] = None,
    ) -> SessionExecutionSettlementResult:
        settled_at = settled_at or datetime.now(timezone.utc)

        async def execute(session: Any) -> SessionExecutionSettlementResult:
            stored = await self.lock_for_control(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
                transaction=session,
            )
            if stored.terminal_outcome is not None:
                return SessionExecutionSettlementResult(settlement=stored, won=False)
            row = (
                await session.execute(
                    sa_update(SessionExecutionDBE)
                    .where(
                        SessionExecutionDBE.project_id == project_id,
                        SessionExecutionDBE.session_id == session_id,
                        SessionExecutionDBE.execution_id == execution_id,
                    )
                    .values(
                        state=SessionExecutionState.terminal.value,
                        terminal_outcome=terminal_outcome,
                        settled_by=settled_by,
                        settled_at=settled_at,
                    )
                    .returning(SessionExecutionDBE)
                )
            ).scalar_one()
            return SessionExecutionSettlementResult(settlement=_to_dto(row), won=True)

        if transaction is not None:
            return await execute(transaction)
        async with self.engine.session() as session:
            return await execute(session)

    async def query_settled(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], SessionExecutionSettlement]:
        if not keys:
            return {}
        key_filter = or_(
            *[
                and_(
                    SessionExecutionDBE.session_id == session_id,
                    SessionExecutionDBE.execution_id == execution_id,
                )
                for session_id, execution_id in keys
            ]
        )
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(SessionExecutionDBE).where(
                        SessionExecutionDBE.project_id == project_id,
                        SessionExecutionDBE.terminal_outcome.is_not(None),
                        key_filter,
                    )
                )
            ).scalars()
            return {(row.session_id, row.execution_id): _to_dto(row) for row in rows}

    async def mark_endings_written(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        written_at: Optional[datetime] = None,
    ) -> None:
        if not keys:
            return
        async with self.engine.session() as session:
            await session.execute(
                sa_update(SessionExecutionDBE)
                .where(
                    SessionExecutionDBE.project_id == project_id,
                    tuple_(
                        SessionExecutionDBE.session_id,
                        SessionExecutionDBE.execution_id,
                    ).in_(keys),
                    SessionExecutionDBE.ending_written_at.is_(None),
                )
                .values(ending_written_at=written_at or datetime.now(timezone.utc))
            )

    async def list_redis_unreconciled(
        self,
        *,
        limit: int,
    ) -> List[SessionExecutionSettlement]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(SessionExecutionDBE)
                    .where(
                        SessionExecutionDBE.settled_by == "runner",
                        SessionExecutionDBE.terminal_outcome == "stopped",
                        SessionExecutionDBE.redis_reconciled_at.is_(None),
                    )
                    .order_by(SessionExecutionDBE.settled_at)
                    .limit(limit)
                )
            ).scalars()
            return [_to_dto(row) for row in rows]

    async def mark_redis_reconciled(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> None:
        async with self.engine.session() as session:
            await session.execute(
                sa_update(SessionExecutionDBE)
                .where(
                    SessionExecutionDBE.project_id == project_id,
                    SessionExecutionDBE.session_id == session_id,
                    SessionExecutionDBE.execution_id == execution_id,
                    SessionExecutionDBE.redis_reconciled_at.is_(None),
                )
                .values(redis_reconciled_at=datetime.now(timezone.utc))
            )
