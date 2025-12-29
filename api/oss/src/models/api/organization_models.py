from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.models.api.user_models import TimestampModel


class Organization(BaseModel):
    id: str
    slug: Optional[str] = None
    #
    name: Optional[str] = None
    description: Optional[str] = None
    #
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    #
    owner_id: UUID
    #
    members: List[str] = Field(default_factory=list)
    invitations: List = Field(default_factory=list)
    workspaces: List[str] = Field(default_factory=list)


class OrganizationMember(TimestampModel):
    id: Optional[str] = None
    email: str
    username: str
    status: Optional[str] = None


class OrganizationDetails(Organization):
    default_workspace: Optional[Dict[str, Any]] = None
