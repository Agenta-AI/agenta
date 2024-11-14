from typing import Optional
from uuid import UUID
from pydantic import BaseModel


class Reference(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None
    version: Optional[str] = None
