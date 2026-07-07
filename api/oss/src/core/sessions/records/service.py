from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface


class RecordsService:
    def __init__(self, records_dao: RecordsDAOInterface):
        self.records_dao = records_dao

    async def append(
        self,
        *,
        event: SessionRecordEvent,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.append(event=event)

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
