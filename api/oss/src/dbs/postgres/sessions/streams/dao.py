from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, select

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamQuery,
    StreamStatusCode,
)
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
    map_stream_dto_to_dbe_edit,
)


class SessionStreamsDAO(SessionStreamsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        stream: SessionStreamCreate,
    ) -> SessionStream:
        dbe = map_stream_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            stream=stream,
        )
        async with self.engine.session() as session:
            session.add(dbe)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def get_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def get_by_id(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.id == stream_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def query(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
    ) -> List[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            if filter.session_id is not None:
                stmt = stmt.where(SessionStreamDBE.session_id == filter.session_id)
            if filter.is_alive is not None:
                stmt = stmt.where(
                    SessionStreamDBE.flags["is_alive"].astext
                    == ("true" if filter.is_alive else "false")
                )
            if filter.is_running is not None:
                stmt = stmt.where(
                    SessionStreamDBE.flags["is_running"].astext
                    == ("true" if filter.is_running else "false")
                )
            stmt = stmt.order_by(SessionStreamDBE.created_at.desc())
            result = await session.execute(stmt)
            dbes = result.scalars().all()
        return [map_stream_dbe_to_dto(stream_dbe=dbe) for dbe in dbes]

    async def update(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        stream: SessionStreamEdit,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            map_stream_dto_to_dbe_edit(
                stream_dbe=dbe,
                user_id=user_id,
                stream=stream,
            )
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return False
            dbe.deleted_at = datetime.now(timezone.utc)
            await session.commit()
        return True

    async def count_active(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> int:
        """Count streams whose status is 'running' (for concurrency cap check)."""
        async with self.engine.session() as session:
            stmt = (
                select(func.count())
                .select_from(SessionStreamDBE)
                .where(
                    SessionStreamDBE.deleted_at.is_(None),
                    SessionStreamDBE.status["code"].astext
                    == StreamStatusCode.running.value,
                )
            )
            if project_id is not None:
                stmt = stmt.where(SessionStreamDBE.project_id == project_id)
            result = await session.execute(stmt)
            return result.scalar_one()
