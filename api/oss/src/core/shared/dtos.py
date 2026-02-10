from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class FolderScope(BaseModel):
    folder_id: Optional[UUID] = None


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email
