from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Lifecycle
from oss.src.core.events.types import RequestID, EventID, RequestType, EventType


class Event(RequestID, EventID, Lifecycle):
    request_type: RequestType
    event_type: EventType

    timestamp: datetime

    status_code: Optional[str] = None
    status_message: Optional[str] = None

    attributes: Optional[Dict[str, Any]] = None


class EventQuery(BaseModel):
    request_id: Optional[UUID] = None

    request_type: Optional[RequestType] = None
    event_type: Optional[EventType] = None
