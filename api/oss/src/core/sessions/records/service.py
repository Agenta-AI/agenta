from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface


class RecordsService:
    def __init__(
        self,
        records_dao: RecordsDAOInterface,
        streams_dao: Optional[SessionStreamsDAOInterface] = None,
    ):
        self.records_dao = records_dao
        self.streams_dao = streams_dao

    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[Any] = None,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.append(event=event, session=session)

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecord]:
        return await self.records_dao.append_many(events=events)

    async def mark_history_incomplete(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> int:
        if self.streams_dao is None:
            return 0
        return await self.streams_dao.mark_history_incomplete(
            project_id=project_id,
            session_ids=session_ids,
        )

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        return await self.records_dao.get_records(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.get_event(
            project_id=project_id,
            record_id=record_id,
        )

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        """One batched lookup for a whole page — never one call per row."""
        if not session_ids:
            return {}

        return await self.records_dao.latest_message_per_session(
            project_id=project_id,
            session_ids=session_ids,
        )
