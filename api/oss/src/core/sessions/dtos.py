from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamQueryFlags
from oss.src.core.shared.dtos import Reference


class SessionListItem(SessionStream):
    """A `/sessions/query` row, enriched at READ time with the session's HIGHEST
    `turn_index` turn's `references` — the agent/workflow that produced the latest turn.

    Hydrated by `SessionsService.query_sessions` via a batch turns lookup; never
    denormalized onto `session_streams` (see that method's docstring)."""

    references: Optional[List[Reference]] = None


class SessionQuery(BaseModel):
    """Root `/sessions/query` filter: reference-scoped, joined through the turns'
    references (WP1's GIN `.contains()`), not denormalized onto the stream row.

    Every predicate a list view offers must live here. A client that filters a windowed
    page filters the window, not the set — wrong counts, wrong empty states."""

    references: Optional[List[Reference]] = None
    # Include ended (killed) sessions so the durable list keeps resumable history — absence then
    # means genuinely hard-deleted, which the frontend uses to prune a locally-cached session.
    include_ended: bool = False
    # Include archived sessions — off by default (archive hides); on for the archived view.
    include_archived: bool = False
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
    # Also return the total matching rows, ignoring windowing. Off by default: a filter chip
    # wants it, a scroll page does not, and it costs a second query.
    include_total: bool = False
