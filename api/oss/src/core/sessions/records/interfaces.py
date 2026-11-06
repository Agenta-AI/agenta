from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
    SessionRecordsPage,
    SessionRecordsReplay,
    SessionRecordsReadState,
    RunnerEnding,
)


class RecordsDAOInterface:
    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[Any] = None,
    ) -> Optional[SessionRecord]:
        raise NotImplementedError

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecord]:
        raise NotImplementedError

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        raise NotImplementedError

    async def has_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: str,
    ) -> bool:
        """Does the log still hold a record of this turn?"""
        raise NotImplementedError

    async def rewound_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Set[Tuple[str, str]]:
        """The (session_id, turn_id) keys a rewind removed."""
        raise NotImplementedError

    async def rewind_from_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: str,
        user_id: Optional[UUID],
        marker: SessionRecordEvent,
    ) -> int:
        """Soft-delete `turn_id` and every later turn, and write `marker` in the same commit.

        Returns the rows removed. Removing none writes nothing."""
        raise NotImplementedError

    async def get_records_page(
        self,
        *,
        project_id: UUID,
        session_id: str,
        offset: int,
        limit: int,
        through_sequence: int,
    ) -> SessionRecordsPage:
        raise NotImplementedError

    async def get_read_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> SessionRecordsReadState:
        raise NotImplementedError

    async def get_records_after(
        self,
        *,
        project_id: UUID,
        session_id: str,
        after: int,
    ) -> SessionRecordsReplay:
        raise NotImplementedError

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        raise NotImplementedError

    async def mark_records_incomplete(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> None:
        """Record that the session's log lost a record. Sets the time once, never clears it."""
        raise NotImplementedError

    async def get_records_incomplete(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        raise NotImplementedError

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        raise NotImplementedError

    async def settled_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        settled_by: Optional[str] = None,
    ) -> Set[Tuple[str, str]]:
        """Which of these `(session_id, turn_id)` pairs already carry a terminal record.

        `settled_by` narrows the answer to endings that one writer wrote; see the DAO.
        """

        raise NotImplementedError

    async def runner_ended_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], RunnerEnding]:
        """Turns with an effective runner terminal record that ends them, and how they ended."""
        raise NotImplementedError
