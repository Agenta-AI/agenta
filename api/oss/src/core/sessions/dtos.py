from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.shared.dtos import Reference


class SessionListItem(SessionStream):
    """A `/sessions/query` row, enriched at READ time with the session's HIGHEST
    `turn_index` turn's `references` — the agent/workflow that produced the latest turn.

    Hydrated by `SessionsService.query_sessions` via a batch turns lookup; never
    denormalized onto `session_streams` (see that method's docstring)."""

    references: Optional[List[Reference]] = None


class SessionQuery(BaseModel):
    """Root `/sessions/query` filter: reference-scoped, joined through the turns'
    references (WP1's GIN `.contains()`), not denormalized onto the stream row."""

    references: Optional[List[Reference]] = None
    # Include ended (killed) sessions so the durable list keeps resumable history — absence then
    # means genuinely hard-deleted, which the frontend uses to prune a locally-cached session.
    include_ended: bool = False
    # Include archived sessions — off by default (archive hides); on for the archived view.
    include_archived: bool = False
    # Case-insensitive substring match over the session title (`session_streams.name`).
    search: Optional[str] = None
