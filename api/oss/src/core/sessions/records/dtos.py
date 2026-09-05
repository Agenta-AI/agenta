from datetime import datetime
from typing import Annotated, Optional, Any, Dict, Literal, Union
from uuid import UUID

from orjson import dumps
from pydantic import BaseModel, Field, model_validator

from oss.src.core.shared.dtos import Lifecycle, OTelSpanId

# The DAO truncates at the SQL level (`left(attributes->>'text', ...)`) — this bound
# just keeps the DTO honest about that contract for any other producer.
SESSION_MESSAGE_PREVIEW_TEXT_LIMIT = 240
MAX_LIVE_FRAME_BYTES = 64 * 1024

# The runner's terminal per-turn record type, mirrored from
# services/runner/src/protocol.ts (`{ type: "done" }`). Also spelled in the records DAO and
# the ingest worker, which read the same marker off their own layers.
TERMINAL_RECORD_TYPE = "done"

# Who wrote a terminal record, stamped into `attributes` by the writer.
#
# Only the platform ever sets it: the ingest route builds `SessionRecordEvent` field by field
# from the request body and has no path to this key, so a runner cannot claim to be the
# watchdog. It exists because the two endings are otherwise identical — the watchdog copies
# the runner's `{"type": "done"}` deliberately, so one outcome never reaches a user in two
# wordings — and the late-record guard has to tell them apart.
RECORD_SETTLED_BY_ATTRIBUTE = "settled_by"
SETTLED_BY_WATCHDOG = "watchdog"


class SessionRecordEvent(BaseModel):
    project_id: UUID
    session_id: str

    record_id: Optional[UUID] = None
    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None

    # Forward-fill only (tracing-DB rule): populated on new records, null on old ones.
    turn_id: Optional[str] = None
    span_id: Optional[OTelSpanId] = None

    # Set ONLY by the ingest guard in `RecordsService.append_many`, never by a producer: the
    # ingest route builds this DTO field by field and never reads this one off the wire. A
    # non-null value means the record arrived for a turn the watchdog had already ended, so it
    # is kept as evidence and left out of the transcript. See `RecordsService.append_many`.
    quarantined_at: Optional[datetime] = None


class SessionLiveFrame(BaseModel):
    version: Literal[1]
    kind: Literal["frame"]
    session_id: str
    execution_id: str
    frame_or_event_id: str
    frame_index: int = Field(ge=0)
    entity_id: str
    type: str
    payload: Dict[str, Any]
    created_at: datetime

    @model_validator(mode="after")
    def validate_serialized_size(self) -> "SessionLiveFrame":
        size = len(dumps(self.model_dump(mode="json")))
        if size > MAX_LIVE_FRAME_BYTES:
            raise ValueError(
                f"serialized live frame exceeds {MAX_LIVE_FRAME_BYTES} bytes"
            )
        return self


class SessionExecutionError(BaseModel):
    code: str
    message: str
    retryable: bool
    details: Optional[Dict[str, Any]] = None


class ExecutionStartedPayload(BaseModel):
    started_at: datetime


class ExecutionStoppedPayload(BaseModel):
    stopped_at: datetime
    reason: str
    command_id: Optional[str] = None


class ExecutionFailedPayload(BaseModel):
    failed_at: datetime
    error: SessionExecutionError


class ExecutionLostPayload(BaseModel):
    lost_at: datetime
    reason: str
    history_complete: Literal[False]


class MessageCompletedPayload(BaseModel):
    message_id: str
    role: str
    content: Any
    finish_reason: Optional[str] = None


class ToolCompletedPayload(BaseModel):
    tool_call_id: str
    name: str
    input: Any
    output: Any = None
    error: Any = None
    status: str


class SessionDurableEventBase(BaseModel):
    """Durable relay wire envelope.

    ``watermark`` is a non-negative integer. On a live event it is the highest sequence
    committed for that session in the publishing records-worker batch; on the SSE ``ready``
    frame the same field name is the authoritative session sequence cursor after replay. A
    client that receives a ready frame without it keeps the requested ``after`` cursor.
    """

    version: Literal[1] = 1
    kind: Literal["event"] = "event"
    session_id: str
    execution_id: str
    frame_or_event_id: str
    entity_id: str
    sequence: Optional[int] = Field(default=None, ge=1)
    watermark: int = Field(ge=0)
    created_at: datetime


class ExecutionStartedEvent(SessionDurableEventBase):
    type: Literal["execution.started"]
    payload: ExecutionStartedPayload


class ExecutionStoppedEvent(SessionDurableEventBase):
    type: Literal["execution.stopped"]
    payload: ExecutionStoppedPayload


class ExecutionFailedEvent(SessionDurableEventBase):
    type: Literal["execution.failed"]
    payload: ExecutionFailedPayload


class ExecutionLostEvent(SessionDurableEventBase):
    type: Literal["execution.lost"]
    payload: ExecutionLostPayload


class MessageCompletedEvent(SessionDurableEventBase):
    type: Literal["message.completed"]
    payload: MessageCompletedPayload


class ToolCompletedEvent(SessionDurableEventBase):
    type: Literal["tool.completed"]
    payload: ToolCompletedPayload


SessionDurableEvent = Annotated[
    Union[
        ExecutionStartedEvent,
        ExecutionStoppedEvent,
        ExecutionFailedEvent,
        ExecutionLostEvent,
        MessageCompletedEvent,
        ToolCompletedEvent,
    ],
    Field(discriminator="type"),
]


class SessionDurableEventsReplay(BaseModel):
    events: list[SessionDurableEvent]
    watermark: int = Field(ge=0)


SESSION_DURABLE_EVENT_TYPES = {
    "execution.started",
    "execution.stopped",
    "execution.failed",
    "execution.lost",
    "message.completed",
    "tool.completed",
}


class SessionRecord(Lifecycle):
    record_id: UUID

    session_id: str
    project_id: UUID

    sequence: Optional[int] = None

    record_index: Optional[int] = None
    timestamp: Optional[datetime] = None
    record_type: Optional[str] = None
    record_source: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None

    turn_id: Optional[str] = None
    span_id: Optional[OTelSpanId] = None

    # Non-null when this record was written for an already-settled turn. Reads that rebuild a
    # transcript filter these out at the DAO; the column is exposed so support and billing can
    # still see the work the agent did after the platform closed the turn.
    quarantined_at: Optional[datetime] = None


class SessionMessagePreview(BaseModel):
    """The last thing said in a session, for a list row.

    A session row carried a title and a timestamp, so deciding whether a session was worth
    reopening meant opening it. Only `message` records are considered: `done`/`usage` are
    bookkeeping, `thought` is not addressed to anyone, and a `tool_call` says what the agent
    reached for rather than what it concluded.
    """

    text: str = Field(max_length=SESSION_MESSAGE_PREVIEW_TEXT_LIMIT)
    # "user" or "agent" — the row prefixes your own messages so a preview isn't mistaken for a reply.
    source: Optional[str] = None
    timestamp: Optional[datetime] = None


class SessionRecordQuery(BaseModel):
    session_id: str


class SessionRecordsReadState(BaseModel):
    latest_sequence: int = Field(ge=0)
    history_complete: bool


class SessionRecordsPage(BaseModel):
    records: list[SessionRecord]
    offset: int = Field(ge=0)
    limit: int = Field(ge=1)
    next_offset: Optional[int] = Field(default=None, ge=0)
    through_sequence: int = Field(ge=0)


class SessionRecordsReplay(BaseModel):
    records: list[SessionRecord]
    watermark: int = Field(ge=0)
