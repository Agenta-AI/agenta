from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.utcnow())
    updated_at: datetime = Field(datetime.utcnow())


class User(TimestampModel):
    uid: str
    username: str
    email: str  # switch to EmailStr when langchain support pydantic>=2.1
    organization_id: str


class UserUpdate(BaseModel):
    username: Optional[str]
    email: Optional[str]
    updated_at: datetime = Field(datetime.utcnow())
