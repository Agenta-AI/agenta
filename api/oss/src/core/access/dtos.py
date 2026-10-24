from enum import Enum
from typing import Union

from pydantic import BaseModel

from oss.src.core.access.permissions.types import Permission


class RoleRequirement(BaseModel):
    role: str  # slug; the legacy `role=...` check


Action = Union[Permission, RoleRequirement]


class DecisionReason(str, Enum):
    ROLE = "role"
    PROJECT_OWNER = "project_owner"
    ORGANIZATION_OWNER = "organization_owner"
    RBAC_NOT_ENTITLED = "rbac_not_entitled"
    NOT_MEMBER = "not_member"
    MISSING_CAPABILITY = "missing_capability"
    # M2 adds PRINCIPAL_INACTIVE, RESTRICTED_BY_AUTHORITY. M3 adds RESOURCE_DENIED.


class Decision(BaseModel):
    allowed: bool
    reason: DecisionReason
