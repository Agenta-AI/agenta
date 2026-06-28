from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.transcripts.dtos import (
    SessionTranscript,
    SessionTranscriptEvent,
)


class TranscriptsDAOInterface:
    async def append(
        self,
        *,
        event: SessionTranscriptEvent,
    ) -> Optional[SessionTranscript]:
        raise NotImplementedError

    async def get_transcript(
        self,
        *,
        project_id: UUID,
        session_id: UUID,
    ) -> List[SessionTranscript]:
        raise NotImplementedError

    async def get_event(
        self,
        *,
        project_id: UUID,
        event_id: UUID,
    ) -> Optional[SessionTranscript]:
        raise NotImplementedError
