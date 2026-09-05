from datetime import datetime
from typing import Annotated, Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from oss.src.core.sessions.dtos import (
    SessionExpansion,
    SessionListItem,
    SessionOrigin,
)
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQueryFlags,
)
from oss.src.core.sessions.records.dtos import (
    SessionLiveFrame,
    SessionRecord,
    SessionRecordsReadState,
)
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionData,
    SessionInteractionFlags,
    SessionInteractionKind,
    SessionInteractionQuery,
    SessionInteractionStatus,
)
from oss.src.core.sessions.mounts.dtos import SessionMount, SessionMountQuery
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurn, SessionTurnQuery
from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import OTelSpanId, Windowing
from oss.src.dbs.postgres.sessions.streams.dao import MAX_SESSION_QUERY_LIMIT


# ---------------------------------------------------------------------------
# Root session-level request/response models (query/delete/archive/unarchive)
# ---------------------------------------------------------------------------


SessionId = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_\-]+$"),
]


class SessionPredicatesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search: Optional[str] = None
    liveness: Optional[SessionStreamQueryFlags] = None
    origins: Optional[List[SessionOrigin]] = None


class SessionExcludeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origins: Optional[List[SessionOrigin]] = None
    session_ids: Optional[List[SessionId]] = Field(default=None, max_length=500)


class SessionQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session: Optional[SessionPredicatesRequest] = None
    # Canonical explicit set selection. It intersects with turn_references.
    session_ids: Optional[List[SessionId]] = Field(default=None, max_length=500)
    exclude: Optional[SessionExcludeRequest] = None
    turn_references: Optional[List[SessionReference]] = None
    # Include ended (killed) sessions so the list keeps resumable history, not just live ones.
    include_ended: bool = False
    # Include archived sessions — off by default (archive hides); on to widen the active list.
    include_archived: bool = False
    # Return ONLY archived sessions. Wins over `include_archived`: this is the archived view.
    archived_only: bool = False
    # Also return `total`. Off by default — a filter chip wants it, a scroll page does not.
    include_total: bool = False
    expand: List[SessionExpansion] = Field(default_factory=list)
    windowing: Optional[Windowing] = None

    # Compatibility inputs for the currently released flat predicates.
    references: Optional[List[SessionReference]] = None
    # Case-insensitive substring match over the session title (`session_streams.name`).
    search: Optional[str] = None
    # Liveness filter (alive ⊇ running ⊇ attached) against the row's mirrored flags.
    flags: Optional[SessionStreamQueryFlags] = None
    # Released flat exclusion alias for exclude.session_ids.
    exclude_session_ids: Optional[List[SessionId]] = Field(default=None, max_length=500)
    # Who started the session. Absent means every origin.
    origin: Optional[SessionOrigin] = None
    # Its negation — hides one origin while still showing sessions with no stamp at all.
    exclude_origin: Optional[SessionOrigin] = None

    @field_validator("windowing")
    @classmethod
    def _bound_windowing_limit(cls, value: Optional[Windowing]) -> Optional[Windowing]:
        # `Windowing` is the shared SDK model (also used by tracing/otel), so its
        # `limit` carries no bound of its own. `limit: 0` compiled to no SQL LIMIT
        # at all — an authenticated caller could dump the whole project in one
        # request (P0-1). Bound it here, at the request model.
        if value is not None and value.limit is not None:
            if not (1 <= value.limit <= MAX_SESSION_QUERY_LIMIT):
                raise ValueError(
                    f"windowing.limit must be between 1 and {MAX_SESSION_QUERY_LIMIT}."
                )
        return value


class SessionsResponse(BaseModel):
    count: int = 0
    # Total matching rows ignoring windowing, when `include_total` was requested. `count` stays
    # the number of rows in THIS page, per the shared envelope convention.
    total: Optional[int] = None
    # `SessionListItem` = `SessionStream` + the latest turn's `references` (WP0-R3),
    # absent (excluded by response_model_exclude_none) when the session has no turns yet.
    sessions: List[SessionListItem] = Field(default_factory=list)
    windowing: Optional[Windowing] = None


class SessionResponse(BaseModel):
    count: int = 0
    session: Optional[SessionStream] = None


# ---------------------------------------------------------------------------
# Streams request/response models
# ---------------------------------------------------------------------------


class SessionDetachRequest(BaseModel):
    session_id: str
    watcher_id: str


class SessionStreamQueryRequest(BaseModel):
    session_id: Optional[str] = None
    is_alive: Optional[bool] = None
    is_running: Optional[bool] = None


class SessionStreamResponse(BaseModel):
    stream: Optional[SessionStream] = None


class SessionStreamsResponse(BaseModel):
    count: int
    streams: List[SessionStream]


# ---------------------------------------------------------------------------
# Records request/response models
# ---------------------------------------------------------------------------


class SessionTranscriptWindowing(BaseModel):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=200)
    through_sequence: int = Field(ge=0)


class SessionRecordQueryRequest(BaseModel):
    session_id: str
    windowing: Optional[SessionTranscriptWindowing] = None


class SessionRecordsQueryResponse(BaseModel):
    count: int
    records: List[SessionRecord]
    windowing: Optional[SessionTranscriptWindowing] = None


class SessionSnapshotPending(BaseModel):
    inputs: List[Any] = Field(default_factory=list)
    interactions: List[SessionInteraction] = Field(default_factory=list)


class SessionSnapshotResponse(BaseModel):
    session: SessionStream
    execution: Optional[SessionTurn] = None
    pending: SessionSnapshotPending
    read: SessionRecordsReadState


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


class SessionInteractionResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["approved", "denied"]
    tool_call_id: str


class SessionInteractionTransitionRequest(BaseModel):
    # No project_id: scope comes from the caller's credential (request.state).
    session_id: str
    token: str
    status: SessionInteractionStatus
    # The router owns kind-specific validation because the row kind is not known here.
    resolution: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_resolution_status(self) -> "SessionInteractionTransitionRequest":
        # Resolution is valid only on lifecycle edges that settle an answer.
        if self.resolution is not None and self.status not in (
            SessionInteractionStatus.responded,
            SessionInteractionStatus.resolved,
        ):
            raise ValueError(
                "resolution is only valid when status is responded or resolved"
            )
        return self


class SessionInteractionCancelStaleRequest(BaseModel):
    # Cancels prior turns' pending gates, sparing this turn's own (`turn_id`) and every prior
    # gate still owned by a live partial resume (`tokens`, including carried gates).
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
    # For a user_approval interaction the answer is {approved: bool, tool_call_id?: str,
    # message?: str} — the dispatcher composes the full resume conversation server-side
    # (interactions_dispatcher.compose_approval_messages). Other kinds pass through as-is.
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
# Attachments request/response models
# ---------------------------------------------------------------------------


class SessionAttachment(BaseModel):
    attachment_id: UUID
    filename: str
    media_type: str
    size: int
    created_at: datetime


class SessionAttachmentResponse(BaseModel):
    count: int = 0
    attachment: SessionAttachment


class SessionAttachmentReferenceRequest(BaseModel):
    session_id: str
    attachment_ids: List[UUID] = Field(max_length=100)


class SessionAttachmentsResponse(BaseModel):
    count: int = 0
    attachments: List[SessionAttachment] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Turns request/response models
# ---------------------------------------------------------------------------


class SessionTurnAppendRequest(BaseModel):
    # No project_id: scope comes from the caller's credential (request.state).
    session_id: str
    turn_id: Optional[UUID] = None
    stream_id: UUID
    turn_index: int
    harness_kind: HarnessKind
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[SessionReference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[OTelSpanId] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnCompleteRequest(BaseModel):
    session_id: str
    turn_index: int
    agent_session_id: Optional[str] = None
    end_time: datetime


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
    kind: Optional[Literal["frame"]] = None
    # Optional stable id (uuid5) from the producer; absent when it has no stable key.
    record_id: Optional[UUID] = None
    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    # The turn this record belongs to; span_id bridges to observability when available.
    # Both forward-fill only (tracing-DB rule) — absent on producers that predate this.
    turn_id: Optional[str] = None
    span_id: Optional[OTelSpanId] = None
    version: Optional[Literal[1]] = None
    execution_id: Optional[str] = None
    frame_or_event_id: Optional[str] = None
    frame_index: Optional[int] = Field(default=None, ge=0)
    entity_id: Optional[str] = None
    type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_live_frame(self) -> "SessionRecordIngestRequest":
        if self.kind != "frame":
            return self
        required = (
            "version",
            "execution_id",
            "frame_or_event_id",
            "frame_index",
            "entity_id",
            "type",
            "payload",
            "created_at",
        )
        missing = [name for name in required if getattr(self, name) is None]
        if missing:
            raise ValueError(f"frame fields missing: {', '.join(missing)}")
        SessionLiveFrame(
            version=self.version,
            kind="frame",
            session_id=self.session_id,
            execution_id=self.execution_id,
            frame_or_event_id=self.frame_or_event_id,
            frame_index=self.frame_index,
            entity_id=self.entity_id,
            type=self.type,
            payload=self.payload,
            created_at=self.created_at,
        )
        return self


# ---------------------------------------------------------------------------
# Session control: durable commands (Stop)
# ---------------------------------------------------------------------------


class SessionCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional stale-request guard. When present, the API cancels only this execution and
    # refuses the request if another one is running. When absent, it cancels whichever
    # execution is active when the request is applied. A person never types this: the browser
    # fills it from the session's own state, and a first-party client always sends it.
    expected_execution_id: Optional[str] = Field(
        default=None,
        description=(
            "Optional stale-request guard honored only in cancel mode; ignored for send, "
            "steer, and attach."
        ),
    )


class SessionCommandRef(BaseModel):
    """The durable command an accepted request created. Identity and DELIVERY state only.

    A client must not read execution state from it. `state` says where the command is; the
    session's own state says what the execution is doing.
    """

    id: UUID
    state: Literal["pending", "claimed", "applied", "obsolete"]


class SessionExecutionRef(BaseModel):
    """What the caller should render. `id` is null when the session was idle."""

    id: Optional[str] = None
    state: Literal["stopping", "idle"]


class SessionCancelResponse(BaseModel):
    command: SessionCommandRef
    execution: SessionExecutionRef


class SessionExecutionOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The execution the runner acted on. Null when it held none.
    id: Optional[str] = None
    # stopped: cancelled as asked. not_running: no such execution on this runner.
    # superseded_by_newer_turn: the held execution started after the command arrived.
    # failed: the cancel itself failed.
    state: Literal["stopped", "failed", "not_running", "superseded_by_newer_turn"]
    # Short and human-readable, present only when `state` is "failed".
    error: Optional[str] = Field(default=None, max_length=2000)


class SessionControlOutcomeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replica_id: str = Field(min_length=1, max_length=128)
    # The command's terminal state. `applied` means the runner did the work; `obsolete` means
    # there was nothing to do.
    result: Literal["applied", "obsolete"]
    execution: SessionExecutionOutcome


class SessionCommandSettlement(BaseModel):
    id: UUID
    state: Literal["applied", "obsolete"]
    outcome: Literal[
        "stopped", "not_running", "superseded_by_newer_turn", "failed", "lost"
    ]
    settled_at: Optional[datetime] = None


class SessionControlOutcomeResponse(BaseModel):
    command: SessionCommandSettlement
