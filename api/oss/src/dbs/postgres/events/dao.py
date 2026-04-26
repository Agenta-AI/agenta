from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, or_, and_
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.shared.dtos import Windowing
from oss.src.core.events.dtos import Event, EventQuery
from oss.src.core.events.interfaces import EventsDAOInterface
from oss.src.dbs.postgres.events.dbes import EventDBE
from oss.src.dbs.postgres.events.mappings import (
    map_event_dto_to_dbe,
    map_event_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine


class EventsDAO(EventsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    ### EVENTS

    async def ingest(
        self,
        *,
        project_id: UUID,
        #
        events: List[Event],
    ) -> int:
        if not events:
            return 0

        async with self.engine.session() as session:
            total_ingested = 0

            for event in events:
                event_dbe = map_event_dto_to_dbe(
                    event=event,
                    project_id=project_id,
                )

                values = {
                    c.name: getattr(event_dbe, c.name)
                    for c in EventDBE.__table__.columns
                    if not (
                        getattr(event_dbe, c.name) is None
                        and c.server_default is not None
                    )
                }

                stmt = insert(EventDBE).values(**values)

                update_fields = {
                    c.name: stmt.excluded[c.name]
                    for c in EventDBE.__table__.columns
                    if c.name
                    not in [
                        "project_id",
                        "request_id",
                        "event_id",
                        "created_at",
                        "created_by_id",
                    ]
                }
                update_fields["updated_at"] = datetime.now(timezone.utc)

                stmt = stmt.on_conflict_do_update(
                    index_elements=["project_id", "request_id", "event_id"],
                    set_=update_fields,
                )

                res = await session.execute(stmt)
                total_ingested += int(res.rowcount or 0)

            await session.commit()

            return total_ingested

    async def query(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[EventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Event]:
        async with self.engine.session() as session:
            # BASE
            stmt = select(EventDBE)

            # SCOPING
            stmt = stmt.where(
                EventDBE.project_id == project_id,
            )

            # FILTERING
            if event:
                if event.request_id is not None:
                    stmt = stmt.where(EventDBE.request_id == event.request_id)
                if event.request_type is not None:
                    stmt = stmt.where(EventDBE.request_type == event.request_type)
                if event.event_type is not None:
                    stmt = stmt.where(EventDBE.event_type == event.event_type)

            # WINDOWING
            if windowing:
                order = (windowing.order or "descending").lower()
                if order == "descending":
                    if windowing.newest:
                        if windowing.next:
                            stmt = stmt.where(EventDBE.timestamp <= windowing.newest)
                        else:
                            stmt = stmt.where(EventDBE.timestamp < windowing.newest)
                    if windowing.oldest:
                        stmt = stmt.where(EventDBE.timestamp >= windowing.oldest)
                    if windowing.next and windowing.newest:
                        stmt = stmt.where(
                            or_(
                                EventDBE.timestamp < windowing.newest,
                                and_(
                                    EventDBE.timestamp == windowing.newest,
                                    EventDBE.event_id < windowing.next,
                                ),
                            )
                        )
                    stmt = stmt.order_by(
                        EventDBE.timestamp.desc(), EventDBE.event_id.desc()
                    )
                else:
                    if windowing.newest:
                        stmt = stmt.where(EventDBE.timestamp <= windowing.newest)
                    if windowing.oldest:
                        if windowing.next:
                            stmt = stmt.where(EventDBE.timestamp >= windowing.oldest)
                        else:
                            stmt = stmt.where(EventDBE.timestamp > windowing.oldest)
                    if windowing.next and windowing.oldest:
                        stmt = stmt.where(
                            or_(
                                EventDBE.timestamp > windowing.oldest,
                                and_(
                                    EventDBE.timestamp == windowing.oldest,
                                    EventDBE.event_id > windowing.next,
                                ),
                            )
                        )
                    stmt = stmt.order_by(
                        EventDBE.timestamp.asc(), EventDBE.event_id.asc()
                    )
                if windowing.limit:
                    stmt = stmt.limit(windowing.limit)
            else:
                stmt = stmt.order_by(EventDBE.timestamp.desc())

            dbes = (await session.execute(stmt)).scalars().all()

            if not dbes:
                return []

            return [map_event_dbe_to_dto(event_dbe=dbe) for dbe in dbes]
