from typing import List, Protocol

from oss.src.core.events.dtos import EventIngestDTO, EventQueryDTO, EventDTO


class EventsDAOInterface(Protocol):
    async def ingest(self, *, event_dtos: List[EventIngestDTO]) -> int: ...

    async def query(self, *, project_id, query: EventQueryDTO) -> List[EventDTO]: ...
