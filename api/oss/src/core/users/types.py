from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from typing import Optional

from oss.src.core.auth.types import MethodKind


class UserIdentity(BaseModel):
    id: UUID
    user_id: UUID
    method: MethodKind
    subject: str
    domain: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class UserIdentityCreate(BaseModel):
    user_id: UUID
    method: MethodKind
    subject: str
    domain: Optional[str] = None
