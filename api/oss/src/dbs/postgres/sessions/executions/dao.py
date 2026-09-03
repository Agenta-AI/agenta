from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import and_, cast, func, or_, select, update as sa_update
from sqlalchemy.dialects.postgresql import JSONB, insert

from oss.src.core.sessions.commands.dtos import SessionCommand, SessionCommandSettle
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE
from oss.src.dbs.postgres.sessions.commands.mappings import map_command_dbe_to_dto
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.sessions.interactions.dbes import SessionInteractionDBE
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
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

    async def settle_command_execution(
        self,
        *,
        settle: SessionCommandSettle,
        session_id: str,
        execution_id: Optional[str],
        terminal_outcome: Optional[str],
        settled_by: Optional[str],
        mirror_stopped: bool,
        cancel_interactions: bool,
    ) -> Optional[SessionCommand]:
        now = datetime.now(timezone.utc)
        async with self.engine.session() as session:
            if execution_id and terminal_outcome and settled_by:
                execution_stmt = (
                    insert(SessionExecutionDBE)
                    .values(
                        project_id=settle.project_id,
                        session_id=session_id,
                        execution_id=execution_id,
                        terminal_outcome=terminal_outcome,
                        settled_by=settled_by,
                        settled_at=now,
                    )
                    .on_conflict_do_nothing(
                        index_elements=["project_id", "session_id", "execution_id"]
                    )
                    .returning(SessionExecutionDBE)
                )
                inserted = (await session.execute(execution_stmt)).scalar_one_or_none()
                if inserted is None:
                    stored = (
                        await session.execute(
                            select(SessionExecutionDBE).where(
                                SessionExecutionDBE.project_id == settle.project_id,
                                SessionExecutionDBE.session_id == session_id,
                                SessionExecutionDBE.execution_id == execution_id,
                            )
                        )
                    ).scalar_one()
                    if (
                        stored.terminal_outcome != terminal_outcome
                        or stored.settled_by != settled_by
                    ):
                        await session.rollback()
                        return None

            command_stmt = sa_update(SessionCommandDBE).where(
                SessionCommandDBE.project_id == settle.project_id,
                SessionCommandDBE.id == settle.command_id,
                SessionCommandDBE.state.in_(
                    [state.value for state in settle.expected_states]
                ),
            )
            if settle.replica_id is not None:
                command_stmt = command_stmt.where(
                    or_(
                        SessionCommandDBE.claimed_by.is_(None),
                        SessionCommandDBE.claimed_by == settle.replica_id,
                    )
                )
            command_stmt = command_stmt.values(
                state=settle.state.value,
                outcome=settle.outcome.value,
                settled_at=now,
                updated_at=now,
            ).returning(SessionCommandDBE)
            command = (await session.execute(command_stmt)).scalar_one_or_none()
            if command is None:
                await session.rollback()
                return None

            stream_values = {"stopping_turn_id": None, "updated_at": now}
            if mirror_stopped:
                stream_values["flags"] = func.coalesce(
                    SessionStreamDBE.flags, cast({}, JSONB)
                ).op("||")(cast({"is_running": False, "is_attached": False}, JSONB))
            stream_stmt = sa_update(SessionStreamDBE).where(
                SessionStreamDBE.project_id == settle.project_id,
                SessionStreamDBE.session_id == session_id,
            )
            if execution_id is not None:
                stream_stmt = stream_stmt.where(
                    or_(
                        SessionStreamDBE.stopping_turn_id == execution_id,
                        SessionStreamDBE.stopping_turn_id.is_(None),
                    )
                )
            await session.execute(stream_stmt.values(**stream_values))

            if cancel_interactions and execution_id is not None:
                await session.execute(
                    sa_update(SessionInteractionDBE)
                    .where(
                        SessionInteractionDBE.project_id == settle.project_id,
                        SessionInteractionDBE.session_id == session_id,
                        SessionInteractionDBE.turn_id == execution_id,
                        SessionInteractionDBE.status == "pending",
                    )
                    .values(status="cancelled", updated_at=now)
                )

            await session.commit()
            return map_command_dbe_to_dto(command)

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
