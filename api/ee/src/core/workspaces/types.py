from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from ee.src.models.shared_models import Permission


class WorkspacePermission(BaseModel):
    # Role slugs are dynamic (env-overridable via AGENTA_ACCESS_ROLES);
    # validation against the effective scope catalog happens at the API
    # boundary via `ee.src.core.entitlements.controls.get_role`.
    role_name: str
    role_description: Optional[str] = None
    permissions: Optional[List[Permission]] = None


class WorkspaceMember(BaseModel):
    user_id: str
    roles: List[WorkspacePermission]


class WorkspaceMemberResponse(BaseModel):
    user: Dict[str, Any]
    roles: List[WorkspacePermission]


class WorkspaceResponse(BaseModel):
    id: str

    name: Optional[str] = None
    description: Optional[str] = None

    type: Optional[str]

    organization: str

    members: Optional[List[WorkspaceMemberResponse]] = None

    created_at: str
    updated_at: str


class CreateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    type: Optional[str] = None


class UserRole(BaseModel):
    email: str
    role: Optional[str] = None

    organization_id: str


class UpdateWorkspace(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    updated_at: Optional[datetime] = None
