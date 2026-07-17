from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStream,
)
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
from oss.src.core.sessions.turns.dtos import Harness, SessionTurn, SessionTurnQuery
from oss.src.core.shared.dtos import Reference, Windowing


# ---------------------------------------------------------------------------
# Root session-level request/response models (query/delete/archive/unarchive)
# ---------------------------------------------------------------------------


class SessionQueryRequest(BaseModel):
    references: Optional[List[Reference]] = None
    windowing: Optional[Windowing] = None


class SessionsResponse(BaseModel):
    count: int = 0
    sessions: List[SessionStream] = Field(default_factory=list)


class SessionResponse(BaseModel):
    count: int = 0
    session: Optional[SessionStream] = None


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
#
# /sessions/states/ is the session header surface: it reads/writes the merged
# session_streams row's name/description (S8). Rename is a full-PUT edit, not a
# bespoke verb.
# ---------------------------------------------------------------------------


class SessionStateResponse(BaseModel):
    count: int = Field(default=0)
    session_state: Optional[SessionStream] = Field(default=None)


class SessionStateUpsertRequest(BaseModel):
    name: Optional[str] = Field(default=None, description="Rename target.")
    description: Optional[str] = Field(default=None, description="Rename target.")


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
    # Cancels prior turns' pending gates, sparing this turn's own (`turn_id`) and any gates
    # the current turn answers in-band (`tokens` — a resume must resolve them, not cancel).
    session_id: str
    turn_id: str
    tokens: Optional[List[str]] = None


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
# Turns request/response models
# ---------------------------------------------------------------------------


class SessionTurnAppendRequest(BaseModel):
    # No project_id: scope comes from the caller's credential (request.state).
    session_id: str
    stream_id: UUID
    turn_index: int
    harness: Harness
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[Reference]] = None
    trace_id: Optional[UUID] = None
    root_span_id: Optional[UUID] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnQueryRequest(BaseModel):
    query: Optional[SessionTurnQuery] = None
    windowing: Optional[Windowing] = None


class SessionTurnResponse(BaseModel):
    count: int = 0
    turn: Optional[SessionTurn] = None


class SessionTurnsResponse(BaseModel):
    count: int = 0
    turns: List[SessionTurn] = Field(default_factory=list)


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
