from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class MembershipPolicy(str, Enum):
    ORGANIZATION_WIDE = "organization_wide"  # OSS
    PROJECT_ROWS = "project_rows"  # EE


class MembershipSource(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"


class ProjectScope(BaseModel):
    project_id: UUID
    organization_id: UUID
    workspace_id: UUID  # routing and the workspace mirror, until M4
    organization_owner_id: Optional[UUID] = None
    is_default: bool


class ProjectSummary(ProjectScope):  # the project list response needs the names
    project_name: str
    workspace_name: str
    organization_name: str


class OrganizationMember(BaseModel):
    organization_id: UUID
    user_id: UUID
    role: str


class ProjectMember(BaseModel):
    project_id: UUID
    user_id: UUID
    role: Optional[str] = None  # the column is nullable (an EE row with a null role)


class ProjectMembership(BaseModel):
    """The resolver output. M2 caches it, so every nullable field has a default."""

    project_id: UUID
    user_id: UUID
    organization_id: UUID
    role: Optional[str] = None  # None: an EE project row with a null role
    source: MembershipSource
    is_organization_owner: bool = False


class CachedMembership(BaseModel):
    """The `resolve_membership` cache entry, never returned by the service.

    `membership=None` is a cached absence. A bare `None` cannot be the cached value:
    `get_cache` returns `None` for a miss and for a stored null alike.
    """

    membership: Optional[ProjectMembership] = None


class MembershipRow(BaseModel):
    """DAO output for one (user, project). Never returned by the service."""

    summary: ProjectSummary
    has_organization_row: bool = False
    organization_role: Optional[str] = None  # the oldest organization row's role
    has_project_row: bool = False  # row presence; a present row can have a null role
    project_role: Optional[str] = None  # the oldest project row's role


class ProjectListing(BaseModel):
    """Service output for the project routes."""

    membership: ProjectMembership
    summary: ProjectSummary


class MembershipWriteResult(BaseModel):
    """DAO writer output, for the audit log."""

    user_id: Optional[UUID] = None
    previous_role: Optional[str] = None
    inserted_count: int = 0
    deleted_invitation_count: int = 0


class CreatedProject(BaseModel):
    """DAO `create_project` output."""

    scope: ProjectScope
    seeded_count: int = 0
