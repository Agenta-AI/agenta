from datetime import datetime
from typing import Optional, Any, Dict, List
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Lifecycle, OTelSpanId

# The DAO truncates at the SQL level (`left(attributes->>'text', ...)`) — this bound
# just keeps the DTO honest about that contract for any other producer.
SESSION_MESSAGE_PREVIEW_TEXT_LIMIT = 240

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
    # Retry-stable id for this emitted record. Older APIs ignore this additive field;
    # immutable-history mode uses it when no legacy logical record_id is present.
    producer_id: Optional[UUID] = None
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


class SessionRecord(Lifecycle):
    record_id: UUID

    session_id: str
    project_id: UUID

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


class SessionRecordsAppendResult(BaseModel):
    records: List[SessionRecord] = Field(default_factory=list)
    conflicting_record_ids: List[UUID] = Field(default_factory=list)


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
