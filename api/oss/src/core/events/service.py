from typing import List
from uuid import UUID

from oss.src.core.events.dtos import EventIngestDTO, EventQueryDTO, EventDTO
from oss.src.core.events.interfaces import EventsDAOInterface


class EventsService:
    def __init__(self, events_dao: EventsDAOInterface):
        self.events_dao = events_dao

    async def ingest(self, *, event_dtos: List[EventIngestDTO]) -> int:
        return await self.events_dao.ingest(event_dtos=event_dtos)

    async def query(self, *, project_id: UUID, query: EventQueryDTO) -> List[EventDTO]:
        return await self.events_dao.query(project_id=project_id, query=query)
