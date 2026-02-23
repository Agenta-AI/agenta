from datetime import datetime
from typing import Optional, Dict, Any, Literal, List
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.events.types import FlowType
from oss.src.core.tracing.dtos import OTelStatusCode


class EventIngestDTO(BaseModel):
    organization_id: Optional[UUID] = None
    project_id: UUID
    created_by_id: UUID

    flow_id: UUID
    event_id: UUID

    flow_type: FlowType
    event_type: str
    event_name: str

    timestamp: datetime
    status_code: Optional[OTelStatusCode] = None
    status_message: Optional[str] = None

    attributes: Optional[Dict[str, Any]] = None


class EventDTO(BaseModel):
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


class EventQueryDTO(BaseModel):
    flow_id: Optional[UUID] = None
    flow_type: Optional[FlowType] = None
    event_type: Optional[str] = None
    event_name: Optional[str] = None
    status_code: Optional[OTelStatusCode] = None

    timestamp_from: Optional[datetime] = None
    timestamp_to: Optional[datetime] = None

    order_by: Literal["timestamp", "created_at"] = "timestamp"
    order: Literal["asc", "desc"] = "desc"
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class EventSignalDTO(BaseModel):
    organization_id: Optional[UUID] = None
    project_id: UUID
    user_id: UUID

    flow_id: UUID
    event_id: UUID

    flow_type: FlowType
    event_type: str
    event_name: str

    timestamp: datetime
    status_code: Optional[OTelStatusCode] = None
    status_message: Optional[str] = None

    attributes: Optional[Dict[str, Any]] = None


class EventsResponseDTO(BaseModel):
    count: int
    events: List[EventDTO]
