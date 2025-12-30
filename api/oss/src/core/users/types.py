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
    domain: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class UserIdentityCreate(BaseModel):
    user_id: UUID
    method: MethodKind
    subject: str
    domain: Optional[str] = None
    created_by_id: Optional[UUID] = None
