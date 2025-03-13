from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field

from oss.src.models.api.user_models import TimestampModel


class Organization(BaseModel):
    id: str
    name: str
    owner: str
    description: str
    type: Optional[str] = None
    workspaces: List[str] = Field(default_factory=list)


class OrganizationMember(TimestampModel):
    id: Optional[str] = None
    email: str
    username: str
    status: Optional[str] = None


class OrganizationDetails(Organization):
    default_workspace: Optional[Dict[str, Any]] = None
