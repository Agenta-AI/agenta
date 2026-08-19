"""Root session-level operations: query/list, delete, archive, unarchive.

Orchestrates across the session facets (streams, turns, interactions, mounts),
anchored on `session_id` — the universal handle. Fan-out NEVER routes through
`stream_id`. Records (tracing DB) are READ here for the list's message preview and
never written; tracing retention still owns their lifecycle.

peek is NOT a verb and NOT built here: the individual reads (this service's
`query_sessions`, the streams/turns/records fetch-and-query endpoints) are the
whole surface. The front-end composes them — see `apis/fastapi/sessions/router.py`
module docstring for the read-walk.
"""

import asyncio
from typing import Dict, List, Optional, Set
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.sessions.dtos import (
    SessionExpansion,
    SessionListItem,
    SessionQuery,
    SessionQueryLifecycle,
    SessionQueryOptions,
    SessionQueryPage,
)
from oss.src.core.sessions.records.dtos import SessionMessagePreview
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQuery,
    SessionStreamReadOptions,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.mounts.service import MountsService
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

# Hard cap on the id set resolved from `turn_references` (P2-12): the explicit
# `session_ids`/`exclude_session_ids` request fields are already capped at 500;
# this derived set rode along unbounded (a full turns-table scan for a broad
# reference filter).
TURN_REFERENCES_SESSION_ID_CAP = 500


def _stream_filter(
    query: Optional[SessionQuery], lifecycle: SessionQueryLifecycle
) -> SessionStreamQuery:
    """The row predicate shared by the list and its total."""
    return SessionStreamQuery(
        include_ended=lifecycle.include_ended,
        include_archived=lifecycle.include_archived,
        search=query.search if query else None,
        flags=query.flags if query else None,
        origins=query.origins if query else None,
        exclude_origins=query.exclude_origins if query else None,
    )


class SessionsService:
    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        turns_service: SessionTurnsService,
        interactions_service: SessionInteractionsService,
        mounts_service: MountsService,
        # Optional: records live in the tracing DB, so a deployment without that engine still
        # lists sessions — it just lists them without previews.
        records_service: Optional[RecordsService] = None,
    ) -> None:
        self.streams_service = streams_service
        self.turns_service = turns_service
        self.interactions_service = interactions_service
        self.mounts_service = mounts_service
        self.records_service = records_service

    async def query_sessions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionQuery] = None,
        lifecycle: Optional[SessionQueryLifecycle] = None,
        options: Optional[SessionQueryOptions] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionListItem]:
        """List/filter sessions, newest -> oldest, windowed.

        Reads the merged stream rows; when `turn_references` is set, resolves the
        matching `session_id`s from BOTH reference columns (the turns' references
        and the stream row's own fill-once `references`, each GIN `.contains()`),
        unions them, then filters the stream query to that set. See
        `_resolve_session_ids` for the per-side caps and ordering.

        Each row is enriched (READ-time only, see `SessionListItem`) with its last
        message via a single batch lookup keyed on every listed `session_id` — never one
        call per row (WP0-R3). `references` come from the stream row when it has them and
        fall back to the same batch lookup's latest turn otherwise.
        """
        page = await self.query_sessions_page(
            project_id=project_id,
            query=query,
            lifecycle=lifecycle,
            options=options,
            windowing=windowing,
        )
        return page.sessions

    async def query_sessions_page(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionQuery] = None,
        lifecycle: Optional[SessionQueryLifecycle] = None,
        options: Optional[SessionQueryOptions] = None,
        windowing: Optional[Windowing] = None,
    ) -> SessionQueryPage:
        lifecycle = lifecycle or SessionQueryLifecycle()
        options = options or SessionQueryOptions()
        session_ids = await self._resolve_session_ids(
            project_id=project_id, query=query
        )

        sessions = await self._query_sessions(
            project_id=project_id,
            query=query,
            lifecycle=lifecycle,
            options=options,
            windowing=windowing,
            session_ids=session_ids,
        )
        total = (
            await self._count_sessions(
                project_id=project_id,
                query=query,
                lifecycle=lifecycle,
                session_ids=session_ids,
            )
            if options.include_total
            else None
        )
        return SessionQueryPage(sessions=sessions, total=total)

    async def _query_sessions(
        self,
        *,
        project_id: UUID,
        query: Optional[SessionQuery],
        lifecycle: SessionQueryLifecycle,
        options: SessionQueryOptions,
        windowing: Optional[Windowing],
        session_ids: Optional[List[str]],
    ) -> List[SessionListItem]:
        if session_ids is not None and not session_ids:
            return []

        streams = await self.streams_service.query_streams(
            project_id=project_id,
            filter=_stream_filter(query, lifecycle),
            windowing=windowing,
            session_ids=session_ids,
            exclude_session_ids=query.exclude_session_ids if query else None,
            read_options=SessionStreamReadOptions(
                include_trigger_details=SessionExpansion.trigger in options.expand
            ),
        )

        if not streams:
            return []

        listed_ids = [stream.session_id for stream in streams]

        latest_turns_lookup = self.turns_service.latest_turn_per_session(
            project_id=project_id, session_ids=listed_ids
        )
        if SessionExpansion.last_message in options.expand:
            latest_turns_task = asyncio.create_task(latest_turns_lookup)
            previews_task = asyncio.create_task(
                self._latest_message_previews(
                    project_id=project_id,
                    session_ids=listed_ids,
                )
            )
            try:
                latest_turns = await latest_turns_task
            except BaseException:
                previews_task.cancel()
                await asyncio.gather(previews_task, return_exceptions=True)
                raise
            previews = await previews_task
        else:
            latest_turns = await latest_turns_lookup
            previews = {}

        items = []
        for stream in streams:
            turn = latest_turns.get(stream.session_id)
            items.append(
                SessionListItem(
                    **stream.model_dump(exclude={"references"}),
                    # The row's own references first: they are written by the beat, which
                    # every run makes, whereas the turn append is fire-and-forget. The turn
                    # is the fallback that keeps pre-column rows openable.
                    references=stream.references or (turn.references if turn else None),
                    last_message=previews.get(stream.session_id),
                )
            )
        return items

    async def _latest_message_previews(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        if self.records_service is None:
            return {}
        try:
            return await self.records_service.latest_message_per_session(
                project_id=project_id,
                session_ids=session_ids,
            )
        except Exception:
            log.warning(
                "[SESSIONS] latest-message lookup failed",
                project_id=str(project_id),
                exc_info=True,
            )
            return {}

    async def count_sessions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionQuery] = None,
        lifecycle: Optional[SessionQueryLifecycle] = None,
    ) -> int:
        """Total sessions matching the filter, ignoring windowing — what a filter chip
        shows. Same predicate as `query_sessions`, so a page and its total agree."""
        session_ids = await self._resolve_session_ids(
            project_id=project_id, query=query
        )
        return await self._count_sessions(
            project_id=project_id,
            query=query,
            lifecycle=lifecycle or SessionQueryLifecycle(),
            session_ids=session_ids,
        )

    async def _count_sessions(
        self,
        *,
        project_id: UUID,
        query: Optional[SessionQuery],
        lifecycle: SessionQueryLifecycle,
        session_ids: Optional[List[str]],
    ) -> int:
        if session_ids is not None and not session_ids:
            return 0

        return await self.streams_service.count_streams(
            project_id=project_id,
            filter=_stream_filter(query, lifecycle),
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

        `turn_references` resolves through the turns; `session_ids` arrives from the caller
        (pins, a pending-interaction lookup). Given both, the restriction is their
        INTERSECTION — each narrows, so an id must satisfy both. An empty list (as opposed
        to `None`) means the filters can match nothing, and callers short-circuit on it.
        """
        if not query:
            return None

        from_references: Optional[Set[str]] = None
        if query.turn_references is not None:
            if not query.turn_references:
                return []
            # Both reference columns, unioned: a session whose turn append was dropped is
            # findable only through the stream row, and one that predates that column only
            # through its turns. Matching either is what makes an agent-scoped list agree
            # with what the list can actually open.
            by_turns, by_streams = await asyncio.gather(
                self.turns_service.query_session_ids_by_references(
                    project_id=project_id,
                    references=query.turn_references,
                    limit=TURN_REFERENCES_SESSION_ID_CAP,
                ),
                self.streams_service.query_session_ids_by_references(
                    project_id=project_id,
                    references=query.turn_references,
                    limit=TURN_REFERENCES_SESSION_ID_CAP,
                ),
            )
            from_references = set(by_turns) | set(by_streams)
            # Re-cap the union: each side is capped on its own, so their union could carry
            # twice the bound P2-12 put on this derived set. Each side already returns its
            # most recently active matches, so the ids reaching here are the ones worth
            # keeping; WHICH of them survives this final trim is arbitrary though, because
            # the two lists carry no timestamp to merge on. It only bites a project with
            # more than the cap of sessions matching one reference, where the list is
            # windowed regardless. Carrying activity timestamps up through both DAOs to
            # merge exactly is the fix if that ever stops being true.
            if len(from_references) > TURN_REFERENCES_SESSION_ID_CAP:
                from_references = set(
                    sorted(from_references)[:TURN_REFERENCES_SESSION_ID_CAP]
                )

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
