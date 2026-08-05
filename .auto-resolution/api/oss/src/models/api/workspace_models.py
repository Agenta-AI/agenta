from datetime import datetime
from typing import Any, Dict, Optional, List

from pydantic import BaseModel

from oss.src.models.api.api_models import TimestampModel
from oss.src.core.access.permissions.types import Permission


class Workspace(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    type: Optional[str]


class WorkspacePermission(BaseModel):
    # Role slugs are dynamic (env-overridable via AGENTA_ACCESS_ROLES in EE);
    # validation against the effective scope catalog happens at the API boundary.
    role_name: str
    role_description: Optional[str] = None
    permissions: Optional[List[Permission]] = None


class WorkspaceMember(BaseModel):
    user_id: str
    roles: List[WorkspacePermission]


class WorkspaceMemberResponse(BaseModel):
    user: Dict[str, Any]
    roles: List[WorkspacePermission]


class InviteRequest(BaseModel):
    email: str
    # Role slugs are dynamic at runtime (env-overridable via AGENTA_ACCESS_ROLES);
    # validation against the effective workspace catalog happens at the API
    # boundary via `ee.src.core.access.controls.get_role`.
    roles: Optional[List[str]] = None


class InviteToken(BaseModel):
    token: str
    email: str


class ResendInviteRequest(BaseModel):
    email: str


class UserRole(BaseModel):
    email: str
    role: Optional[str] = None

    organization_id: str


class WorkspaceResponse(TimestampModel):
    id: str
    name: str
    description: Optional[str] = None
    type: Optional[str]
    organization: str
    members: Optional[List[WorkspaceMemberResponse]] = None


class CreateWorkspace(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = None


class UpdateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    updated_at: Optional[datetime] = None
