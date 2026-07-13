from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.sessions.records.dtos import (
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE
from oss.src.dbs.postgres.sessions.records.mappings import (
    map_record_event_to_dbe,
    map_record_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine


class RecordsDAO(RecordsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[AsyncSession] = None,
    ) -> Optional[SessionRecord]:
        if session is None:
            async with self.engine.session() as session:
                return await self.append(event=event, session=session)

        stmt = self._upsert_stmt(values_list=[self._values(event=event)])
        result = await session.execute(stmt)
        await session.commit()

        row = result.scalars().first()
        if row is None:
            return None
        return map_record_dbe_to_dto(dbe=row)

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecord]:
        """Upsert all events via one batched statement in one session, not one
        connection (or one round trip) per event."""
        if not events:
            return []

        values_list = [self._values(event=event) for event in events]

        async with self.engine.session() as session:
            stmt = self._upsert_stmt(values_list=values_list)
            result = await session.execute(stmt)
            await session.commit()

            return [map_record_dbe_to_dto(dbe=row) for row in result.scalars().all()]

    @staticmethod
    def _values(*, event: SessionRecordEvent) -> dict:
        dbe = map_record_event_to_dbe(event=event)
        return {
            c.name: getattr(dbe, c.name)
            for c in RecordDBE.__table__.columns
            if not (getattr(dbe, c.name) is None and c.server_default is not None)
        }

    @staticmethod
    def _upsert_stmt(*, values_list: List[dict]):
        stmt = insert(RecordDBE).values(values_list)
        return stmt.on_conflict_do_update(
            index_elements=["project_id", "record_id"],
            set_={
                "record_type": stmt.excluded.record_type,
                "record_source": stmt.excluded.record_source,
                "timestamp": stmt.excluded.timestamp,
                "attributes": stmt.excluded.attributes,
            },
        ).returning(RecordDBE)

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        async with self.engine.session() as session:
            stmt = (
                select(RecordDBE)
                .where(
                    RecordDBE.project_id == project_id,
                    RecordDBE.session_id == session_id,
                )
                .order_by(RecordDBE.created_at.asc(), RecordDBE.record_index.asc())
            )

            dbes = (await session.execute(stmt)).scalars().all()
            return [map_record_dbe_to_dto(dbe=dbe) for dbe in dbes]

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        async with self.engine.session() as session:
            stmt = select(RecordDBE).where(
                RecordDBE.project_id == project_id,
                RecordDBE.record_id == record_id,
            )

            dbe = (await session.execute(stmt)).scalars().first()
            if dbe is None:
                return None
            return map_record_dbe_to_dto(dbe=dbe)
