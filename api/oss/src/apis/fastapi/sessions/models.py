from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.sessions.streams.dtos import (
    InvokeMode,
    SessionLiveness,
    SessionStream,
    SessionStreamStatus,
)
from oss.src.core.sessions.states.dtos import SessionState
from oss.src.core.sessions.transcripts.dtos import Transcript
from oss.src.core.sessions.interactions.dtos import (
    Interaction,
    InteractionCreate,
    InteractionQuery,
    InteractionTransition,
)
from oss.src.core.shared.dtos import Windowing


# ---------------------------------------------------------------------------
# Streams request/response models
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


class SessionStateSandboxIdUpsertRequest(BaseModel):
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id. Pass null to clear.",
    )


# ---------------------------------------------------------------------------
# Transcripts request/response models
# ---------------------------------------------------------------------------


class TranscriptQueryRequest(BaseModel):
    session_id: UUID


class TranscriptsQueryResponse(BaseModel):
    count: int
    transcripts: List[Transcript]


class TranscriptResponse(BaseModel):
    transcript: Optional[Transcript] = None


# ---------------------------------------------------------------------------
# Interactions request/response models
# ---------------------------------------------------------------------------


class InteractionCreateRequest(BaseModel):
    interaction: InteractionCreate


class InteractionTransitionRequest(BaseModel):
    transition: InteractionTransition


class InteractionQueryRequest(BaseModel):
    query: Optional[InteractionQuery] = None
    windowing: Optional[Windowing] = None


class InteractionResponse(BaseModel):
    count: int = 0
    interaction: Optional[Interaction] = None


class InteractionsResponse(BaseModel):
    count: int = 0
    interactions: List[Interaction] = Field(default_factory=list)


class InteractionRespondRequest(BaseModel):
    answer: Optional[Dict[str, Any]] = None
