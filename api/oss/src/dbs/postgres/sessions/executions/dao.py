from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import and_, literal_column, or_, select, update as sa_update
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.sessions.executions.dtos import (
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
        terminal_outcome=row.terminal_outcome,
        settled_by=row.settled_by,
        settled_at=row.settled_at,
        redis_reconciled_at=row.redis_reconciled_at,
    )


class SessionExecutionsDAO(SessionExecutionsDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

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
        stmt = (
            insert(SessionExecutionDBE)
            .values(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
                terminal_outcome=terminal_outcome,
                settled_by=settled_by,
                settled_at=settled_at,
            )
            .on_conflict_do_update(
                index_elements=["project_id", "session_id", "execution_id"],
                set_={"terminal_outcome": SessionExecutionDBE.terminal_outcome},
            )
            .returning(
                SessionExecutionDBE,
                literal_column("xmax = 0").label("won"),
            )
        )

        async def execute(session: Any) -> SessionExecutionSettlementResult:
            stored, won = (await session.execute(stmt)).one()
            return SessionExecutionSettlementResult(settlement=_to_dto(stored), won=won)

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
                        key_filter,
                    )
                )
            ).scalars()
            return {(row.session_id, row.execution_id): _to_dto(row) for row in rows}

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
