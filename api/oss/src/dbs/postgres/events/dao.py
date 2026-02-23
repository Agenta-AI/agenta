from datetime import datetime, timezone
from typing import List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.events.dtos import EventIngestDTO, EventQueryDTO, EventDTO
from oss.src.core.events.interfaces import EventsDAOInterface
from oss.src.dbs.postgres.events.dbes import EventDBE
from oss.src.dbs.postgres.events.mappings import (
    map_event_dto_to_dbe,
    map_event_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import engine


class EventsDAO(EventsDAOInterface):
    async def ingest(self, *, event_dtos: List[EventIngestDTO]) -> int:
        if not event_dtos:
            return 0

        now = datetime.now(timezone.utc)

        values = []
        for event_dto in event_dtos:
            event_dbe = map_event_dto_to_dbe(event_dto=event_dto)
            value = {
                c.name: getattr(event_dbe, c.name) for c in EventDBE.__table__.columns
            }
            value["updated_at"] = now
            value["updated_by_id"] = event_dto.created_by_id
            values.append(value)

        stmt = insert(EventDBE).values(values)
        update_fields = {
            c.name: stmt.excluded[c.name]
            for c in EventDBE.__table__.columns
            if c.name
            not in [
                "project_id",
                "flow_id",
                "event_id",
                "created_at",
                "created_by_id",
            ]
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=["project_id", "flow_id", "event_id"],
            set_=update_fields,
        )

        async with engine.tracing_session() as session:
            res = await session.execute(stmt)
            await session.commit()
            return int(res.rowcount or 0)

    async def query(self, *, project_id: UUID, query: EventQueryDTO) -> List[EventDTO]:
        async with engine.tracing_session() as session:
            stmt = select(EventDBE).where(
                EventDBE.project_id == project_id,
                EventDBE.deleted_at.is_(None),
            )

            if query.flow_id is not None:
                stmt = stmt.where(EventDBE.flow_id == query.flow_id)
            if query.flow_type is not None:
                stmt = stmt.where(EventDBE.flow_type == query.flow_type)
            if query.event_type is not None:
                stmt = stmt.where(EventDBE.event_type == query.event_type)
            if query.event_name is not None:
                stmt = stmt.where(EventDBE.event_name == query.event_name)
            if query.status_code is not None:
                stmt = stmt.where(EventDBE.status_code == query.status_code)
            if query.timestamp_from is not None:
                stmt = stmt.where(EventDBE.timestamp >= query.timestamp_from)
            if query.timestamp_to is not None:
                stmt = stmt.where(EventDBE.timestamp <= query.timestamp_to)

            order_col = (
                EventDBE.created_at
                if query.order_by == "created_at"
                else EventDBE.timestamp
            )
            stmt = stmt.order_by(
                order_col.asc() if query.order == "asc" else order_col.desc()
            )
            stmt = stmt.offset(query.offset).limit(query.limit)

            rows = (await session.execute(stmt)).scalars().all()
            return [map_event_dbe_to_dto(event_dbe=row) for row in rows]
