from datetime import datetime
from typing import Optional, Any, Dict
from uuid import UUID

from pydantic import BaseModel


class SessionRecordEvent(BaseModel):
    session_id: UUID
    project_id: UUID

    event_index: Optional[int] = None
    sender: Optional[str] = None
    session_update: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class SessionRecord(BaseModel):
    id: UUID

    session_id: UUID
    project_id: UUID

    event_index: Optional[int] = None
    sender: Optional[str] = None
    session_update: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

    created_at: Optional[datetime] = None


class SessionRecordQuery(BaseModel):
    session_id: UUID
