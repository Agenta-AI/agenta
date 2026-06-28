from typing import List, Optional
from uuid import UUID

from oss.src.core.transcripts.dtos import Transcript, TranscriptEvent


class TranscriptsDAOInterface:
    async def append(
        self,
        *,
        event: TranscriptEvent,
    ) -> Optional[Transcript]:
        raise NotImplementedError

    async def get_transcript(
        self,
        *,
        project_id: UUID,
        session_id: UUID,
    ) -> List[Transcript]:
        raise NotImplementedError

    async def get_event(
        self,
        *,
        project_id: UUID,
        event_id: UUID,
    ) -> Optional[Transcript]:
        raise NotImplementedError
