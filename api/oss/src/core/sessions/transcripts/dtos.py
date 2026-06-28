from datetime import datetime
from typing import Optional, Any, Dict
from uuid import UUID

from pydantic import BaseModel


class SessionTranscriptEvent(BaseModel):
    session_id: UUID
    project_id: UUID

    event_index: Optional[int] = None
    sender: Optional[str] = None
    session_update: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class SessionTranscript(BaseModel):
    id: UUID

    session_id: UUID
    project_id: UUID

    event_index: Optional[int] = None
    sender: Optional[str] = None
    session_update: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

    created_at: Optional[datetime] = None


class SessionTranscriptQuery(BaseModel):
    session_id: UUID
