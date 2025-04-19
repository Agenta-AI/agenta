from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel

from oss.src.models.api.api_models import TimestampModel


class Workspace(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    type: Optional[str]


class InviteRequest(BaseModel):
    email: str
    roles: Optional[List[str]] = None


class InviteToken(BaseModel):
    token: str
    email: str


class ResendInviteRequest(BaseModel):
    email: str


class WorkspaceResponse(TimestampModel):
    id: str
    name: str
    description: Optional[str] = None
    type: Optional[str]
    organization: str


class CreateWorkspace(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = None


class UpdateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    updated_at: Optional[datetime] = None
