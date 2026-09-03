from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
    SessionRecordsAppendResult,
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
    ) -> SessionRecordsAppendResult:
        raise NotImplementedError

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        raise NotImplementedError

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        raise NotImplementedError

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        raise NotImplementedError
