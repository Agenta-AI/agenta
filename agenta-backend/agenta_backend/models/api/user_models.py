from typing import Optional, List
from datetime import datetime, timezone

from pydantic import BaseModel, Field


class TimestampModel(BaseModel):
    created_at: str = Field(str(datetime.now(timezone.utc)))
    updated_at: str = Field(str(datetime.now(timezone.utc)))


class User(TimestampModel):
    id: Optional[str] = None
    uid: str
    username: str
    email: str
    organizations: Optional[List[str]] = None


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    updated_at: str = Field(str(datetime.now(timezone.utc)))
