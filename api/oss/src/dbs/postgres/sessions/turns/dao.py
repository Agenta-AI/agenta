from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, delete as sa_delete, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnComplete,
    SessionTurnCreate,
    SessionTurnQuery,
)
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.sessions.turns.dbes import SessionTurnDBE
from oss.src.dbs.postgres.sessions.turns.mappings import (
    map_turn_dbe_to_dto,
    map_turn_dto_to_dbe_create,
)
from oss.src.dbs.postgres.sessions.turns.utils import query_turn_references
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


class SessionTurnsDAO(SessionTurnsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def append(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        turn: SessionTurnCreate,
    ) -> SessionTurn:
        dbe = map_turn_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            turn=turn,
        )
        async with self.engine.session() as session:
            try:
                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)
            except IntegrityError as e:
                await session.rollback()
                error_str = str(e.orig) if e.orig else str(e)
                if "ix_session_turns_project_id_session_id_turn_index" in error_str:
                    raise EntityCreationConflict(
                        entity="Session turn",
                        message=(
                            f"Session turn {turn.turn_index} already exists for "
                            f"session {turn.session_id}."
                        ),
                        conflict={
                            "session_id": turn.session_id,
                            "turn_index": turn.turn_index,
                        },
                    ) from e
                raise
        return map_turn_dbe_to_dto(turn_dbe=dbe)

    async def complete(
        self,
        *,
        project_id: UUID,
        #
        turn: SessionTurnComplete,
    ) -> Optional[SessionTurn]:
        values = {"end_time": turn.end_time}
        if turn.agent_session_id is not None:
            values["agent_session_id"] = turn.agent_session_id

        async with self.engine.session() as session:
            stmt = (
                sa_update(SessionTurnDBE)
                .where(
                    SessionTurnDBE.project_id == project_id,
                    SessionTurnDBE.session_id == turn.session_id,
                    SessionTurnDBE.turn_index == turn.turn_index,
                    SessionTurnDBE.end_time.is_(None),
                )
                .values(**values)
                .returning(SessionTurnDBE)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is not None:
                await session.commit()
                await session.refresh(dbe)
                return map_turn_dbe_to_dto(turn_dbe=dbe)

            stmt = select(SessionTurnDBE).where(
                SessionTurnDBE.project_id == project_id,
                SessionTurnDBE.session_id == turn.session_id,
                SessionTurnDBE.turn_index == turn.turn_index,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()

        if dbe is None:
            return None
        return map_turn_dbe_to_dto(turn_dbe=dbe)

    async def fetch_turn(
        self,
        *,
        project_id: UUID,
        #
        turn_id: UUID,
    ) -> Optional[SessionTurn]:
        async with self.engine.session() as session:
            stmt = select(SessionTurnDBE).where(
                SessionTurnDBE.project_id == project_id,
                SessionTurnDBE.id == turn_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_turn_dbe_to_dto(turn_dbe=dbe)

    async def query_turns(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionTurnQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionTurn]:
        async with self.engine.session() as session:
            stmt = select(SessionTurnDBE).where(
                SessionTurnDBE.project_id == project_id,
            )

            if query is not None:
                if query.session_id is not None:
                    stmt = stmt.where(
                        SessionTurnDBE.session_id == query.session_id,
                    )
                if query.stream_id is not None:
                    stmt = stmt.where(
                        SessionTurnDBE.stream_id == query.stream_id,
                    )
                if query.harness_kind is not None:
                    stmt = stmt.where(
                        SessionTurnDBE.harness_kind == query.harness_kind.value,
                    )
                if query.references is not None:
                    turn_references = query_turn_references(query)
                    if turn_references is not None:
                        stmt = stmt.where(
                            SessionTurnDBE.references.contains(turn_references),
                        )

            descending = windowing is None or windowing.order != "ascending"
            time_attribute = SessionTurnDBE.start_time

            if windowing:
                if windowing.newest is not None:
                    if descending and windowing.next is None:
                        stmt = stmt.where(time_attribute < windowing.newest)
                    else:
                        stmt = stmt.where(time_attribute <= windowing.newest)
                if windowing.oldest is not None:
                    if not descending and windowing.next is None:
                        stmt = stmt.where(time_attribute > windowing.oldest)
                    else:
                        stmt = stmt.where(time_attribute >= windowing.oldest)

                if windowing.next is not None:
                    cursor_stmt = select(
                        SessionTurnDBE.turn_index,
                        SessionTurnDBE.id,
                    ).where(
                        SessionTurnDBE.project_id == project_id,
                        SessionTurnDBE.id == windowing.next,
                    )
                    cursor_result = await session.execute(cursor_stmt)
                    cursor = cursor_result.one_or_none()
                    if cursor is not None:
                        cursor_index, cursor_id = cursor
                        if descending:
                            stmt = stmt.where(
                                or_(
                                    SessionTurnDBE.turn_index < cursor_index,
                                    and_(
                                        SessionTurnDBE.turn_index == cursor_index,
                                        SessionTurnDBE.id < cursor_id,
                                    ),
                                )
                            )
                        else:
                            stmt = stmt.where(
                                or_(
                                    SessionTurnDBE.turn_index > cursor_index,
                                    and_(
                                        SessionTurnDBE.turn_index == cursor_index,
                                        SessionTurnDBE.id > cursor_id,
                                    ),
                                )
                            )

            if descending:
                stmt = stmt.order_by(
                    SessionTurnDBE.turn_index.desc(),
                    SessionTurnDBE.id.desc(),
                )
            else:
                stmt = stmt.order_by(
                    SessionTurnDBE.turn_index.asc(),
                    SessionTurnDBE.id.asc(),
                )

            if windowing and windowing.limit:
                stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)
            return [map_turn_dbe_to_dto(turn_dbe=dbe) for dbe in result.scalars().all()]

    async def latest_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionTurn]:
        async with self.engine.session() as session:
            stmt = (
                select(SessionTurnDBE)
                .where(
                    SessionTurnDBE.project_id == project_id,
                    SessionTurnDBE.session_id == session_id,
                )
                .order_by(SessionTurnDBE.turn_index.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_turn_dbe_to_dto(turn_dbe=dbe)

    async def latest_turn_per_harness_kind(
        self,
        *,
        project_id: UUID,
        session_id: str,
        harness_kind: HarnessKind,
    ) -> Optional[SessionTurn]:
        async with self.engine.session() as session:
            stmt = (
                select(SessionTurnDBE)
                .where(
                    SessionTurnDBE.project_id == project_id,
                    SessionTurnDBE.session_id == session_id,
                    SessionTurnDBE.harness_kind == harness_kind.value,
                )
                .order_by(SessionTurnDBE.turn_index.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_turn_dbe_to_dto(turn_dbe=dbe)

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> int:
        """Hard delete — no soft-delete for turns (session-scoped fan-out, WP5)."""
        async with self.engine.session() as session:
            stmt = sa_delete(SessionTurnDBE).where(
                SessionTurnDBE.project_id == project_id,
                SessionTurnDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount or 0
