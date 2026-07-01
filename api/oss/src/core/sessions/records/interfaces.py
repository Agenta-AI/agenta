from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionRecord,
    SessionRecordEvent,
)


class RecordsDAOInterface:
    async def append(
        self,
        *,
        event: SessionRecordEvent,
    ) -> Optional[SessionRecord]:
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
