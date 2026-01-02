from datetime import datetime
from typing import Optional, List, Dict

from pydantic import BaseModel

from ee.src.models.api.api_models import TimestampModel
from ee.src.models.shared_models import WorkspaceRole, Permission


class WorkspacePermission(BaseModel):
    role_name: WorkspaceRole
    role_description: Optional[str] = None
    permissions: Optional[List[Permission]] = None


class WorkspaceMember(BaseModel):
    user_id: str
    roles: List[WorkspacePermission]


class WorkspaceMemberResponse(BaseModel):
    user: Dict
    roles: List[WorkspacePermission]


class Workspace(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str]
    members: Optional[List[WorkspaceMember]] = None


class WorkspaceResponse(TimestampModel):
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str]
    organization: str
    members: Optional[List[WorkspaceMemberResponse]] = None


class CreateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None


class UserRole(BaseModel):
    email: str
    organization_id: str
    role: Optional[str] = None


class UpdateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    updated_at: Optional[datetime] = None
