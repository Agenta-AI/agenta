from typing import Optional, Dict, Any, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field

from oss.src.core.events.types import FlowType
from oss.src.core.tracing.dtos import OTelStatusCode


class EventQueryRequest(BaseModel):
    flow_id: Optional[UUID] = None
    flow_type: Optional[FlowType] = None
    event_type: Optional[str] = None
    event_name: Optional[str] = None
    status_code: Optional[OTelStatusCode] = None
    timestamp_from: Optional[datetime] = None
    timestamp_to: Optional[datetime] = None
    order_by: str = "timestamp"
    order: str = "desc"
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class EventResponse(BaseModel):
    project_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_by_id: UUID
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None
    flow_id: UUID
    event_id: UUID
    flow_type: FlowType
    event_type: str
    event_name: str
    timestamp: datetime
    status_code: Optional[OTelStatusCode] = None
    status_message: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class EventsQueryResponse(BaseModel):
    count: int
    events: List[EventResponse]
