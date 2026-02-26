from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.events.dtos import Event, EventQuery
from oss.src.core.events.interfaces import EventsDAOInterface


class EventsService:
    def __init__(self, events_dao: EventsDAOInterface):
        self.events_dao = events_dao

    async def ingest(
        self,
        *,
        project_id: UUID,
        #
        events: List[Event],
    ) -> int:
        return await self.events_dao.ingest(
            project_id=project_id,
            events=events,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[EventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Event]:
        return await self.events_dao.query(
            project_id=project_id,
            #
            event=event,
            #
            windowing=windowing,
        )
