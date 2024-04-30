from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime, timezone


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.now(timezone.utc))
    updated_at: datetime = Field(datetime.now(timezone.utc))


class User(TimestampModel):
    id: Optional[str]
    uid: str
    username: str
    email: str  # switch to EmailStr when langchain support pydantic>=2.1
    organizations: Optional[List[str]]


class UserUpdate(BaseModel):
    username: Optional[str]
    email: Optional[str]
    updated_at: datetime = Field(datetime.now(timezone.utc))
