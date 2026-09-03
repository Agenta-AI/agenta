from datetime import datetime, timezone
from typing import Dict, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import and_, or_, select, update as sa_update
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
        records_closed_at=row.records_closed_at,
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
            .on_conflict_do_nothing(
                index_elements=["project_id", "session_id", "execution_id"]
            )
            .returning(SessionExecutionDBE)
        )
        async with self.engine.session() as session:
            inserted = (await session.execute(stmt)).scalar_one_or_none()
            if inserted is not None:
                return SessionExecutionSettlementResult(
                    settlement=_to_dto(inserted), won=True
                )
            stored = (
                await session.execute(
                    select(SessionExecutionDBE).where(
                        SessionExecutionDBE.project_id == project_id,
                        SessionExecutionDBE.session_id == session_id,
                        SessionExecutionDBE.execution_id == execution_id,
                    )
                )
            ).scalar_one()
            return SessionExecutionSettlementResult(
                settlement=_to_dto(stored), won=False
            )

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

    async def close_records(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        settled_by: str,
    ) -> None:
        if not keys:
            return
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
            await session.execute(
                sa_update(SessionExecutionDBE)
                .where(
                    SessionExecutionDBE.project_id == project_id,
                    SessionExecutionDBE.settled_by == settled_by,
                    SessionExecutionDBE.records_closed_at.is_(None),
                    key_filter,
                )
                .values(records_closed_at=datetime.now(timezone.utc))
            )
