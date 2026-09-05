from datetime import datetime
from enum import Enum
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Identifier, Lifecycle


class PendingInputState(str, Enum):
    pending = "pending"
    promoted = "promoted"
    removed = "removed"


class PendingInput(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    content: Dict[str, Any]
    position: int
    state: PendingInputState
    policy: Literal["queue", "steer"]
    idempotency_key: str
    request_fingerprint: str
    promoted_execution_id: Optional[str] = None


class PendingInputCreate(BaseModel):
    project_id: UUID
    session_id: str
    content: Dict[str, Any]
    policy: Literal["queue", "steer"]
    idempotency_key: str
    request_fingerprint: str


class PendingInputAdmission(BaseModel):
    action: Literal["execute", "pending"]
    input: Optional[PendingInput] = None
    execution_id: Optional[str] = None


class PendingInputPromotion(BaseModel):
    input: PendingInput
    execution_id: str
    created_at: datetime
