from typing import Optional
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class LifecycleDTO(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None


class IdentifierDTO(BaseModel):
    id: UUID


class SlugDTO(BaseModel):
    slug: str


class HeaderDTO(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
