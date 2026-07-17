"""Session turns service — one row per turn, the transcript twin of a trace.

The latest turn's agent_session_id / sandbox_id IS the current resume pointer (a
query, not a stored fold — a late lower-index write can never win ORDER BY
turn_index DESC LIMIT 1).
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnCreate,
    SessionTurnQuery,
)
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface


class SessionTurnsService:
    def __init__(
        self,
        *,
        turns_dao: SessionTurnsDAOInterface,
    ) -> None:
        self._dao = turns_dao

    async def append_turn(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        turn: SessionTurnCreate,
    ) -> SessionTurn:
        return await self._dao.append(
            project_id=project_id,
            user_id=user_id,
            turn=turn,
        )

    async def fetch_turn(
        self,
        *,
        project_id: UUID,
        #
        turn_id: UUID,
    ) -> Optional[SessionTurn]:
        return await self._dao.fetch_turn(
            project_id=project_id,
            turn_id=turn_id,
        )

    async def query_turns(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionTurnQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionTurn]:
        return await self._dao.query_turns(
            project_id=project_id,
            query=query,
            windowing=windowing,
        )

    async def latest_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionTurn]:
        """The resume-read: latest_turn_index / agent_session_id / sandbox_id are this row."""
        return await self._dao.latest_turn(
            project_id=project_id,
            session_id=session_id,
        )

    async def latest_turn_per_harness_kind(
        self,
        *,
        project_id: UUID,
        session_id: str,
        harness_kind: HarnessKind,
    ) -> Optional[SessionTurn]:
        """The per-harness-kind resume-read."""
        return await self._dao.latest_turn_per_harness_kind(
            project_id=project_id,
            session_id=session_id,
            harness_kind=harness_kind,
        )

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> int:
        """Hard delete every turn for a session (S7 delete fan-out, WP5)."""
        return await self._dao.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
