from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStream,
    SessionStreamStatus,
)
from oss.src.core.sessions.states.dtos import SessionState
from oss.src.core.sessions.transcripts.dtos import SessionTranscript
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionCreate,
    SessionInteractionQuery,
    SessionInteractionTransition,
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
    replica_id: str
    turn_id: Optional[str] = None
    is_running: bool = True
    status: Optional[SessionStreamStatus] = None


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
    data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Opaque SDK SessionRecord to persist.",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id to record alongside the SDK record.",
    )


# ---------------------------------------------------------------------------
# Transcripts request/response models
# ---------------------------------------------------------------------------


class SessionTranscriptQueryRequest(BaseModel):
    session_id: UUID


class SessionTranscriptsQueryResponse(BaseModel):
    count: int
    transcripts: List[SessionTranscript]


class SessionTranscriptResponse(BaseModel):
    transcript: Optional[SessionTranscript] = None


# ---------------------------------------------------------------------------
# Interactions request/response models
# ---------------------------------------------------------------------------


class SessionInteractionCreateRequest(BaseModel):
    interaction: SessionInteractionCreate


class SessionInteractionTransitionRequest(BaseModel):
    transition: SessionInteractionTransition


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
# Admin transcript ingest model
# ---------------------------------------------------------------------------


class SessionTranscriptIngestRequest(BaseModel):
    # project scope comes from the caller's credential, never the body
    session_id: str
    event_index: Optional[int] = None
    sender: Optional[str] = None
    session_update: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
