from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.transcripts.dtos import Transcript


class TranscriptQueryRequest(BaseModel):
    session_id: UUID


class TranscriptsQueryResponse(BaseModel):
    count: int
    transcripts: List[Transcript]


class TranscriptResponse(BaseModel):
    transcript: Optional[Transcript] = None
