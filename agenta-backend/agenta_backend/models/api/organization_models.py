from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.utcnow())
    updated_at: datetime = Field(datetime.utcnow())


class Organization(TimestampModel):
    name: str
    description: Optional[str]


class OrganizationUpdate(BaseModel):
    name: Optional[str]
    description: Optional[str]
