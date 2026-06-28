from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.transcripts.dtos import (
    SessionTranscript,
    SessionTranscriptEvent,
)
from oss.src.core.sessions.transcripts.interfaces import TranscriptsDAOInterface


class TranscriptsService:
    def __init__(self, transcripts_dao: TranscriptsDAOInterface):
        self.transcripts_dao = transcripts_dao

    async def append(
        self,
        *,
        event: SessionTranscriptEvent,
    ) -> Optional[SessionTranscript]:
        return await self.transcripts_dao.append(event=event)

    async def get_transcript(
        self,
        *,
        project_id: UUID,
        session_id: UUID,
    ) -> List[SessionTranscript]:
        return await self.transcripts_dao.get_transcript(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_event(
        self,
        *,
        project_id: UUID,
        event_id: UUID,
    ) -> Optional[SessionTranscript]:
        return await self.transcripts_dao.get_event(
            project_id=project_id,
            event_id=event_id,
        )
