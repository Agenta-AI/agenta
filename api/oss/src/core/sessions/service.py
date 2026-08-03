"""Root session-level operations: query/list, delete, archive, unarchive.

Orchestrates across the session facets (streams, turns, interactions, mounts),
anchored on `session_id` — the universal handle. Fan-out NEVER routes through
`stream_id`. Records (tracing DB) are untouched here; tracing retention owns
them.

peek is NOT a verb and NOT built here: the individual reads (this service's
`query_sessions`, the streams/turns/records fetch-and-query endpoints) are the
whole surface. The front-end composes them — see `apis/fastapi/sessions/router.py`
module docstring for the read-walk.
"""

from typing import List, Optional, Set
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.sessions.dtos import SessionListItem, SessionQuery
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamQuery
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.mounts.service import MountsService


def _stream_filter(query: Optional[SessionQuery]) -> SessionStreamQuery:
    """The row predicate shared by the list and its total."""
    return SessionStreamQuery(
        include_ended=bool(query and query.include_ended),
        include_archived=bool(query and query.include_archived),
        search=query.search if query else None,
        flags=query.flags if query else None,
    )


class SessionsService:
    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        turns_service: SessionTurnsService,
        interactions_service: SessionInteractionsService,
        mounts_service: MountsService,
    ) -> None:
        self.streams_service = streams_service
        self.turns_service = turns_service
        self.interactions_service = interactions_service
        self.mounts_service = mounts_service

    async def query_sessions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionListItem]:
        """List/filter sessions, newest -> oldest, windowed.

        Reads the merged stream rows; when `references` is set, first joins the
        turns' references (WP1's GIN `.contains()`) to resolve the matching
        `session_id`s, then filters the stream query to that set. No
        denormalization onto the stream row (B3) — revisit only if the join
        proves hot.

        Each row is enriched (READ-time only, see `SessionListItem`) with its latest
        turn's `references` via a single batch lookup keyed on every listed
        `session_id` — never one `latest_turn` call per row (WP0-R3).
        """
        session_ids = await self._resolve_session_ids(
            project_id=project_id, query=query
        )
        if session_ids is not None and not session_ids:
            return []

        streams = await self.streams_service.query_streams(
            project_id=project_id,
            filter=_stream_filter(query),
            windowing=windowing,
            session_ids=session_ids,
            exclude_session_ids=query.exclude_session_ids if query else None,
        )

        if not streams:
            return []

        latest_turns = await self.turns_service.latest_turn_per_session(
            project_id=project_id,
            session_ids=[stream.session_id for stream in streams],
        )

        items = []
        for stream in streams:
            turn = latest_turns.get(stream.session_id)
            items.append(
                SessionListItem(
                    **stream.model_dump(),
                    references=turn.references if turn else None,
                )
            )
        return items

    async def count_sessions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionQuery] = None,
    ) -> int:
        """Total sessions matching the filter, ignoring windowing — what a filter chip
        shows. Same predicate as `query_sessions`, so a page and its total agree."""
        session_ids = await self._resolve_session_ids(
            project_id=project_id, query=query
        )
        if session_ids is not None and not session_ids:
            return 0

        return await self.streams_service.count_streams(
            project_id=project_id,
            filter=_stream_filter(query),
            session_ids=session_ids,
            exclude_session_ids=query.exclude_session_ids if query else None,
        )

    async def _resolve_session_ids(
        self,
        *,
        project_id: UUID,
        query: Optional[SessionQuery],
    ) -> Optional[List[str]]:
        """The id set to restrict the stream query to, or `None` for no restriction.

        `references` resolves through the turns; `session_ids` arrives from the caller
        (pins, a pending-interaction lookup). Given both, the restriction is their
        INTERSECTION — each narrows, so an id must satisfy both. An empty list (as opposed
        to `None`) means the filters can match nothing, and callers short-circuit on it.
        """
        if not query:
            return None

        from_references: Optional[Set[str]] = None
        if query.references:
            matching_turns = await self.turns_service.query_turns(
                project_id=project_id,
                query=SessionTurnQuery(references=query.references),
            )
            from_references = {turn.session_id for turn in matching_turns}

        explicit: Optional[Set[str]] = (
            set(query.session_ids) if query.session_ids is not None else None
        )

        if from_references is None:
            return None if explicit is None else sorted(explicit)
        if explicit is None:
            return sorted(from_references)
        return sorted(from_references & explicit)

    async def delete_session(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> None:
        """Hard delete, `session_id`-scoped fan-out (F1). No DB cascade:

        - session_turns: hard delete (WP1's `delete_by_session_id`).
        - session_interactions: hard delete (new — soft-only before this).
        - the merged stream row: hard delete (new — `kill` only soft-deletes).
        - session-bound mounts: delete the rows + their object-store prefixes
          (explicit, session-aware — mounts are semi-independent).
        - records: UNTOUCHED — cross-DB, tracing retention owns them.
        """
        await self.turns_service.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        await self.interactions_service.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        await self.mounts_service.delete_session_mounts(
            project_id=project_id,
            session_id=session_id,
        )
        await self.streams_service.hard_delete(
            project_id=project_id,
            session_id=session_id,
        )

    async def archive_session(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Soft (`deleted_at`) fan-out (F2): archives the stream row and soft-
        archives the bound mounts too (reversible); folders untouched."""
        await self.mounts_service.archive_session_mounts(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )
        return await self.streams_service.archive(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )

    async def unarchive_session(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Reverse of `archive_session`: clears `deleted_at` on the stream row
        and un-archives the bound mounts."""
        await self.mounts_service.unarchive_session_mounts(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )
        return await self.streams_service.unarchive(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )
