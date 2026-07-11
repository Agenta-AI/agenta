from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStream,
)
from oss.src.core.sessions.states.dtos import SessionState, SessionStateData
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionData,
    SessionInteractionFlags,
    SessionInteractionKind,
    SessionInteractionQuery,
    SessionInteractionStatus,
)
from oss.src.core.sessions.mounts.dtos import SessionMount, SessionMountQuery
from oss.src.core.shared.dtos import Windowing


# ---------------------------------------------------------------------------
# Streams request/response models
# ---------------------------------------------------------------------------


class SessionStreamCommandRequestModel(BaseModel):
    session_id: str
    prompt: Optional[str] = None
    force: bool = False
    detached: bool = False


class SessionHeartbeatRequestModel(BaseModel):
    # project scope comes from the caller's credential, never the body
    session_id: str
    replica_id: str = Field(min_length=1)
    turn_id: Optional[str] = None
    is_running: bool = True


class SessionDetachRequestModel(BaseModel):
    session_id: str
    watcher_id: str


class SessionStreamQueryRequestModel(BaseModel):
    session_id: Optional[str] = None
    is_alive: Optional[bool] = None
    is_running: Optional[bool] = None


class SessionStreamCommandResponseModel(BaseModel):
    mode: CommandMode
    session_id: str
    turn_id: Optional[str] = None
    watcher_id: Optional[str] = None
    detached: bool = False


class SessionStreamResponseModel(BaseModel):
    stream: Optional[SessionStream] = None


class SessionHeartbeatResponseModel(BaseModel):
    # the replica owning the session after the heartbeat's claim; the runner compares it
    # to its own replica_id to refuse serving a session it doesn't own.
    stream: Optional[SessionStream] = None
    replica_id: str


class SessionStreamsResponseModel(BaseModel):
    count: int
    streams: List[SessionStream]


# ---------------------------------------------------------------------------
# States request/response models
# ---------------------------------------------------------------------------


class SessionStateResponse(BaseModel):
    count: int = Field(default=0)
    session_state: Optional[SessionState] = Field(default=None)


class SessionStateUpsertRequest(BaseModel):
    data: Optional[SessionStateData] = Field(
        default=None,
        description="Full replacement of the continuity state (resume ids + staleness guard).",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id to record alongside the continuity state.",
    )
    sandbox_turn_index: Optional[int] = Field(
        default=None,
        description=(
            "the writer's conversation turn index; the pointer write is applied only "
            "when it is >= the row's data.latest_turn_index."
        ),
    )


# ---------------------------------------------------------------------------
# Records request/response models
# ---------------------------------------------------------------------------


class SessionRecordQueryRequest(BaseModel):
    session_id: str


class SessionRecordsQueryResponse(BaseModel):
    count: int
    records: List[SessionRecord]


class SessionRecordResponse(BaseModel):
    record: Optional[SessionRecord] = None


# ---------------------------------------------------------------------------
# Interactions request/response models
# ---------------------------------------------------------------------------


class SessionInteractionCreateRequest(BaseModel):
    # No project_id: scope comes from the caller's credential (request.state).
    session_id: str
    turn_id: Optional[str] = None
    token: str
    kind: SessionInteractionKind
    data: Optional[SessionInteractionData] = None
    flags: SessionInteractionFlags = SessionInteractionFlags()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class SessionInteractionTransitionRequest(BaseModel):
    # No project_id: scope comes from the caller's credential (request.state).
    session_id: str
    token: str
    status: SessionInteractionStatus


class SessionInteractionCancelStaleRequest(BaseModel):
    # Cancels prior turns' pending gates, sparing this turn's own.
    session_id: str
    turn_id: str


class SessionInteractionQueryRequest(BaseModel):
    query: Optional[SessionInteractionQuery] = None
    windowing: Optional[Windowing] = None


class SessionInteractionResponse(BaseModel):
    count: int = 0
    interaction: Optional[SessionInteraction] = None


class SessionInteractionsResponse(BaseModel):
    count: int = 0
    interactions: List[SessionInteraction] = Field(default_factory=list)


class SessionInteractionRespondRequest(BaseModel):
    answer: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Mounts request/response models (session-scoped view; from SessionMount DTO)
# ---------------------------------------------------------------------------


class SessionMountQueryRequest(BaseModel):
    mount: Optional[SessionMountQuery] = None
    windowing: Optional[Windowing] = None


class SessionMountResponse(BaseModel):
    count: int = 0
    mount: Optional[SessionMount] = None


class SessionMountsResponse(BaseModel):
    count: int = 0
    mounts: List[SessionMount] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Admin record ingest model
# ---------------------------------------------------------------------------


class SessionRecordIngestRequest(BaseModel):
    # project scope comes from the caller's credential, never the body
    session_id: str
    # Optional stable id (uuid5) from the producer; absent when it has no stable key.
    record_id: Optional[UUID] = None
    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
