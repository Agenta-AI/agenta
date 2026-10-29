from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.sessions.records.dtos import SessionMessagePreview
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamQueryFlags
from oss.src.core.sessions.types import ReferenceKey as ReferenceKey
from oss.src.core.sessions.types import SessionDelivery as SessionDelivery
from oss.src.core.sessions.types import SessionOrigin as SessionOrigin
from oss.src.core.sessions.types import SessionReference as SessionReference
from oss.src.core.sessions.types import SessionTrigger as SessionTrigger
from oss.src.core.sessions.types import (
    SessionTriggerAttribution as SessionTriggerAttribution,
)
from oss.src.core.sessions.types import SessionTriggerKind as SessionTriggerKind


class SessionListItem(SessionStream):
    """A `/sessions/query` row, enriched at READ time with the session's last message.

    `references` prefers the stream row's own (filled once at run time) and falls back to
    the HIGHEST `turn_index` turn's — the agent/workflow that produced the latest turn.
    The fallback is what keeps rows written before the stream column existed openable.
    Both enrichments are batch lookups keyed on the whole page; never one call per row.

    Hydrated by `SessionsService.query_sessions`."""

    # The session's newest `message` record, hydrated by the same batch pattern. Absent when the
    # session has no message yet, or when the deployment runs without the records (tracing) engine.
    last_message: Optional[SessionMessagePreview] = None


class SessionExpansion(str, Enum):
    last_message = "last_message"
    trigger = "trigger"


class SessionQuery(BaseModel):
    """Root `/sessions/query` filter: reference-scoped, joined through the turns'
    references (WP1's GIN `.contains()`), not denormalized onto the stream row.

    Every predicate a list view offers must live here. A client that filters a windowed
    page filters the window, not the set — wrong counts, wrong empty states."""

    model_config = ConfigDict(extra="forbid")

    turn_references: Optional[List[SessionReference]] = None
    # Case-insensitive substring match over the session title (`session_streams.name`).
    search: Optional[str] = None
    # Liveness (alive ⊇ running ⊇ attached), matched against the row's mirrored `flags`.
    flags: Optional[SessionStreamQueryFlags] = None
    # Restrict to an explicit id set. The pushdown for any predicate that lives outside the
    # stream row — pinned ids held client-side, sessions named by a pending-interaction lookup —
    # so the server still owns the intersection, the ordering and the windowing.
    session_ids: Optional[List[str]] = None
    # Its complement: drop known ids from the list, so a group rendered separately (pins) does
    # not appear twice.
    exclude_session_ids: Optional[List[str]] = None
    origins: Optional[List[SessionOrigin]] = None
    exclude_origins: Optional[List[SessionOrigin]] = None


class SessionQueryLifecycle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_ended: bool = False
    include_archived: bool = False
    # The archived VIEW: only archived rows. Wins over `include_archived`.
    archived_only: bool = False


class SessionQueryOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_total: bool = False
    expand: List[SessionExpansion] = Field(default_factory=list)


class SessionQueryPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessions: List[SessionListItem] = Field(default_factory=list)
    total: Optional[int] = None
