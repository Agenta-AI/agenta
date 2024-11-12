from typing import Optional
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class LifecycleDTO(BaseModel):
    created_at: datetime
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None
