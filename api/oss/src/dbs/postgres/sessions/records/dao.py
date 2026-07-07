from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

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
    ) -> Optional[SessionRecord]:
        async with self.engine.session() as session:
            dbe = map_record_event_to_dbe(event=event)

            values = {
                c.name: getattr(dbe, c.name)
                for c in RecordDBE.__table__.columns
                if not (getattr(dbe, c.name) is None and c.server_default is not None)
            }

            stmt = insert(RecordDBE).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["project_id", "record_id"],
                set_={
                    "record_type": stmt.excluded.record_type,
                    "record_source": stmt.excluded.record_source,
                    "timestamp": stmt.excluded.timestamp,
                    "attributes": stmt.excluded.attributes,
                },
            ).returning(RecordDBE)
            result = await session.execute(stmt)
            await session.commit()

            row = result.scalars().first()
            if row is None:
                return None
            return map_record_dbe_to_dto(dbe=row)

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
