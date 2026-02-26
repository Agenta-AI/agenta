from typing import List, Optional, Protocol
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.events.dtos import Event, EventQuery


class EventsDAOInterface(Protocol):
    async def ingest(
        self,
        *,
        project_id: UUID,
        #
        events: List[Event],
    ) -> int: ...

    async def query(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[EventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Event]: ...
