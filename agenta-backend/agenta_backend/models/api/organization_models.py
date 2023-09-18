from datetime import datetime
from bson import ObjectId
from typing import Optional, List
from pydantic import BaseModel, Field
from agenta_backend.models.api.user_models import User


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.utcnow())
    updated_at: datetime = Field(datetime.utcnow())


class Organization(TimestampModel):
    name: str
    description: Optional[str]
    type: Optional[str]
    owner: User
    members: Optional[List[str]]
    invitations: Optional[List]


class OrganizationUpdate(BaseModel):
    name: Optional[str]
    description: Optional[str]
    owner: User
    members: Optional[List[User]]
    invitations: Optional[List]
