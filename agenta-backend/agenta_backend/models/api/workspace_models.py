from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Dict
from agenta_backend.models.api.user_models import TimestampModel
from agenta_backend.models.db_models import WorkspaceRole, Permission


class WorkspacePermission(BaseModel):
    role_name: WorkspaceRole
    permissions: List[Permission]


class WorkspaceMember(BaseModel):
    user_id: str
    roles: List[WorkspacePermission]


class WorkspaceMemberOutput(BaseModel):
    user: Dict
    roles: List[WorkspacePermission]


class Workspace(BaseModel):
    id: Optional[str]
    name: str
    description: Optional[str]
    type: Optional[str]
    members: Optional[List[WorkspaceMember]]


class WorkspaceOutput(TimestampModel):
    id: str
    name: str
    description: Optional[str]
    type: Optional[str]
    organization: str
    members: Optional[List[WorkspaceMemberOutput]]


class CreateWorkspace(BaseModel):
    name: str
    description: Optional[str]
    type: Optional[str]


class UpdateWorkspace(BaseModel):
    name: Optional[str]
    description: Optional[str]
    updated_at: Optional[datetime]
