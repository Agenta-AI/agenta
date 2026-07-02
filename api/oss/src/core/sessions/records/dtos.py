from datetime import datetime
from typing import Optional, Any, Dict
from uuid import UUID

from pydantic import BaseModel


class SessionRecordEvent(BaseModel):
    session_id: str
    project_id: UUID

    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class SessionRecord(BaseModel):
    record_id: UUID

    session_id: str
    project_id: UUID

    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None

    created_at: Optional[datetime] = None


class SessionRecordQuery(BaseModel):
    session_id: str
