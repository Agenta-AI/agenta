from datetime import datetime
from bson import ObjectId
from typing import Optional, List
from pydantic import BaseModel, Field


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.utcnow())
    updated_at: datetime = Field(datetime.utcnow())


class Organization(BaseModel):
    id: Optional[str]
    name: str
    description: Optional[str]
    type: Optional[str]
    owner: str
    members: Optional[List[str]]
    invitations: Optional[List]


class OrganizationUpdate(BaseModel):
    name: Optional[str]
    description: Optional[str]


class OrganizationOutput(BaseModel):
    id: str
    name: str
