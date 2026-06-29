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


class SessionStreamFlags(BaseModel):
    """The nest as primitive bools (alive ⊇ running ⊇ attached).

    resumable (alive & !running) and reattachable (running & !attached) are
    derived client-side, never stored.
    """

    is_alive: bool = False
    is_running: bool = False
    is_attached: bool = False


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
    flags: SessionStreamFlags = SessionStreamFlags()
    turn_id: Optional[str] = None
    status: SessionStreamStatus = SessionStreamStatus()


class SessionStreamCreate(BaseModel):
    session_id: str
    flags: Optional[SessionStreamFlags] = None
    status: Optional[SessionStreamStatus] = None


class SessionStreamEdit(BaseModel):
    flags: Optional[SessionStreamFlags] = None
    status: Optional[SessionStreamStatus] = None


class SessionStreamQuery(BaseModel):
    session_id: Optional[str] = None
    is_alive: Optional[bool] = None
    is_running: Optional[bool] = None


class CommandMode(str, Enum):
    """Derived from the prompt × force matrix."""

    send = "send"  # prompt + no force → 409 if alive
    steer = "steer"  # prompt + force → cancel holder, run new
    cancel = "cancel"  # no prompt + no force → cancel holder
    attach = "attach"  # no prompt + force → steal attached, watch


class SessionStreamCommandRequest(BaseModel):
    """The set_session_stream edit: a state mutation over the lock/row nest.

    Runs nothing itself — the runner (execution plane) is the only thing that runs.
    """

    session_id: str
    prompt: Optional[str] = None
    force: bool = False
    detached: bool = False  # fire-and-forget mode


class SessionStreamCommandResponse(BaseModel):
    mode: CommandMode
    session_id: str
    turn_id: Optional[str] = None
    watcher_id: Optional[str] = None
    detached: bool = False


class SessionHeartbeatRequest(BaseModel):
    session_id: str
    replica_id: str  # the runner CONTAINER (affinity / owner key)
    turn_id: Optional[str] = None  # the current TURN (proves alive-lock ownership)
    is_running: bool = True
    status: Optional[SessionStreamStatus] = None


class SessionLiveness(BaseModel):
    alive: bool
    running: bool
    attached: bool
