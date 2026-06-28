from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.sessions.dtos import (
    InvokeMode,
    SessionLiveness,
    SessionStream,
    SessionStreamStatus,
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class SessionInvokeRequestModel(BaseModel):
    session_id: str
    prompt: Optional[str] = None
    force: bool = False
    detached: bool = False


class SessionHeartbeatRequestModel(BaseModel):
    project_id: UUID
    session_id: str
    replica_id: str
    sandbox_live: bool = True
    status: Optional[SessionStreamStatus] = None


class SessionDetachRequestModel(BaseModel):
    session_id: str
    watcher_id: str


class SessionStreamQueryRequestModel(BaseModel):
    session_id: Optional[str] = None
    sandbox_live: Optional[bool] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class SessionInvokeResponseModel(BaseModel):
    mode: InvokeMode
    session_id: str
    run_id: Optional[str] = None
    detached: bool = False


class SessionLivenessResponseModel(SessionLiveness):
    pass


class SessionStreamResponseModel(BaseModel):
    stream: SessionStream


class SessionStreamsResponseModel(BaseModel):
    count: int
    streams: List[SessionStream]
