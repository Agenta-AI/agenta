from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel


class SessionStreamFlags(BaseModel):
    """The nest as primitive bools (alive ⊇ running ⊇ attached).

    resumable (alive & !running) and reattachable (running & !attached) are
    derived client-side, never stored.
    """

    is_alive: bool = False
    is_running: bool = False
    is_attached: bool = False


class SessionStreamQueryFlags(BaseModel):
    is_alive: Optional[bool] = None
    is_running: Optional[bool] = None
    is_attached: Optional[bool] = None


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
    name: Optional[str] = None
    description: Optional[str] = None
    flags: SessionStreamFlags = SessionStreamFlags()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None


class SessionStreamCreate(BaseModel):
    session_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    flags: Optional[SessionStreamFlags] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None


class SessionStreamEdit(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    flags: Optional[SessionStreamFlags] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None


class SessionStreamHeaderEdit(BaseModel):
    """The rename edit: a full-PUT of the header fields only.

    Distinct from SessionStreamEdit (used by the flag-mirror/heartbeat paths) so the
    liveness-only writes can never carry name/description, and vice versa.
    """

    name: Optional[str] = None
    description: Optional[str] = None


class SessionStreamQuery(BaseModel):
    session_id: Optional[str] = None
    flags: Optional[SessionStreamQueryFlags] = None


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


class SessionLiveness(BaseModel):
    alive: bool
    running: bool
    attached: bool


class SessionHeartbeatResult(BaseModel):
    """A heartbeat's outcome: the reconciled stream plus the session's actual owner replica.

    `replica_id` is the replica that currently holds the affinity key after the claim
    (this caller if it won or already held it, another replica otherwise). The runner reads
    it to refuse serving a local sandbox session it does not own.

    `stream` is None when a losing replica heartbeats a session that has no row yet: it may
    not create or stamp one, since that row belongs to the owner.
    """

    stream: Optional[SessionStream] = None
    replica_id: str
