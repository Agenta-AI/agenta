from uuid import UUID

from pydantic import BaseModel


class SessionStartResult(BaseModel):
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool
