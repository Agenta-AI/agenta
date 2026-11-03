from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.access.dtos import OfferedRoles


class RoleEntry(BaseModel):
    role: str
    description: Optional[str] = None
    permissions: List[str]


class AccessRolesResponse(BaseModel):
    """The role catalog per scope, which also describes stored roles that the plan no
    longer offers, and `offered`, what the caller's organization may set now."""

    organization: List[RoleEntry]
    workspace: List[RoleEntry]
    project: List[RoleEntry]
    offered: OfferedRoles
