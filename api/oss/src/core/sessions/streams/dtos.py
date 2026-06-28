from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class StreamStatusCode(str, Enum):
    running = "running"
    detached = "detached"
    idle = "idle"
    ended = "ended"


class SessionStreamStatus(BaseModel):
    code: Optional[StreamStatusCode] = None
    message: Optional[str] = None


class SessionStream(BaseModel):
    id: UUID
    #
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None
    #
    project_id: UUID
    session_id: str
    attached: bool = False
    sandbox_live: bool = False
    last_seen_at: Optional[datetime] = None
    status: SessionStreamStatus = SessionStreamStatus()


class SessionStreamCreate(BaseModel):
    session_id: str
    attached: bool = False
    sandbox_live: bool = False
    status: Optional[SessionStreamStatus] = None


class SessionStreamEdit(BaseModel):
    attached: Optional[bool] = None
    sandbox_live: Optional[bool] = None
    last_seen_at: Optional[datetime] = None
    status: Optional[SessionStreamStatus] = None


class SessionStreamQuery(BaseModel):
    session_id: Optional[str] = None
    sandbox_live: Optional[bool] = None


class InvokeMode(str, Enum):
    """Derived from the DATA/FORCE matrix in the design."""

    send = "send"  # prompt + no force → 409 if alive
    steer = "steer"  # prompt + force → cancel holder, run new
    cancel = "cancel"  # no prompt + no force → cancel holder
    attach = "attach"  # no prompt + force → steal attached, watch
    detach = "detach"  # connection close → drop attached, run keeps going


class SessionInvokeRequest(BaseModel):
    session_id: str
    prompt: Optional[str] = None
    force: bool = False
    detached: bool = False  # fire-and-forget mode


class SessionInvokeResponse(BaseModel):
    mode: InvokeMode
    session_id: str
    run_id: Optional[str] = None
    detached: bool = False


class SessionHeartbeatRequest(BaseModel):
    session_id: str
    replica_id: str
    sandbox_live: bool = True
    status: Optional[SessionStreamStatus] = None


class SessionLiveness(BaseModel):
    alive: bool
    attached: bool
    reattachable: bool
