from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
)
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.core.shared.dtos import Windowing

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
    map_stream_dto_to_dbe_edit,
    map_stream_dto_to_dbe_header_edit,
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
        try:
            async with self.engine.session() as session:
                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)
        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_session_streams_project_session_id" in error_str:
                raise SessionStreamAlreadyExists(session_id=stream.session_id) from e
            raise
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

    async def get_by_session_id_including_archived(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Like `get_by_session_id`, but also returns a soft-archived row — the
        confirmation read for `archive`/`unarchive` (S7/F2, WP5)."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
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
        windowing: Optional[Windowing] = None,
        session_ids: Optional[List[str]] = None,
    ) -> List[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            if filter.session_id is not None:
                stmt = stmt.where(SessionStreamDBE.session_id == filter.session_id)
            if session_ids is not None:
                stmt = stmt.where(SessionStreamDBE.session_id.in_(session_ids))
            if filter.flags is not None:
                flags_filter = filter.flags.model_dump(
                    exclude_none=True, exclude_unset=True
                )
                if flags_filter:
                    stmt = stmt.where(SessionStreamDBE.flags.contains(flags_filter))
            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=SessionStreamDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
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

    async def update_header(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        header: SessionStreamHeaderEdit,
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
            map_stream_dto_to_dbe_header_edit(
                stream_dbe=dbe,
                user_id=user_id,
                header=header,
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

    async def unarchive_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Clear `deleted_at` on the stream row — the reverse of the archive
        fan-out's `delete_by_session_id` soft-delete (S7/F2, WP5)."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            dbe.deleted_at = None
            dbe.updated_by_id = user_id
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def hard_delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        """Hard delete the merged stream row — `kill`/`delete_by_session_id` only
        soft-delete; this is new plumbing for the session-scoped hard-delete
        fan-out (S7/F1, WP5)."""
        async with self.engine.session() as session:
            stmt = sa_delete(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            return bool(result.rowcount)

    async def count_active(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> int:
        """Count running streams (for concurrency cap check)."""
        async with self.engine.session() as session:
            stmt = (
                select(func.count())
                .select_from(SessionStreamDBE)
                .where(
                    SessionStreamDBE.deleted_at.is_(None),
                    SessionStreamDBE.flags.contains({"is_running": True}),
                )
            )
            if project_id is not None:
                stmt = stmt.where(SessionStreamDBE.project_id == project_id)
            result = await session.execute(stmt)
            return result.scalar_one()
