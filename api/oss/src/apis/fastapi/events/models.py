from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import Windowing
from oss.src.core.events.dtos import Event, EventQuery


class EventQueryRequest(BaseModel):
    event: Optional[EventQuery] = None
    #
    windowing: Optional[Windowing] = None


class EventsQueryResponse(BaseModel):
    count: int
    events: List[Event]
