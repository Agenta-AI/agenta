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

from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.sessions.dtos import SessionQuery
from oss.src.core.sessions.streams.dtos import SessionStream, SessionStreamQuery
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.mounts.service import MountsService


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
    ) -> List[SessionStream]:
        """List/filter sessions, newest -> oldest, windowed.

        Reads the merged stream rows; when `references` is set, first joins the
        turns' references (WP1's GIN `.contains()`) to resolve the matching
        `session_id`s, then filters the stream query to that set. No
        denormalization onto the stream row (B3) — revisit only if the join
        proves hot.
        """
        session_ids: Optional[List[str]] = None

        references: Optional[List[Reference]] = query.references if query else None
        if references:
            matching_turns = await self.turns_service.query_turns(
                project_id=project_id,
                query=SessionTurnQuery(references=references),
            )
            session_ids = sorted({turn.session_id for turn in matching_turns})
            if not session_ids:
                return []

        return await self.streams_service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(),
            windowing=windowing,
            session_ids=session_ids,
        )

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
