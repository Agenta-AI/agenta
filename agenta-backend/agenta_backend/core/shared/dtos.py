from typing import Optional
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class LifecycleDTO(BaseModel):
    created_at: datetime
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None


class ProjectDTO(BaseModel):
    project_id: UUID


class UniversionalDTO(BaseModel):
    id: UUID
    slug: Optional[str] = None


class HeaderDTO(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
