from typing import Optional
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID


class LifecycleDTO(BaseModel):
    created_at: datetime
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None
