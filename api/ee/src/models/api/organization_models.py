from typing import Optional, List

from pydantic import BaseModel, Field


class Organization(BaseModel):
    id: str
    name: str
    description: str
    type: Optional[str] = None
    owner: str
    workspaces: List[str] = Field(default_factory=list)
    members: List[str] = Field(default_factory=list)
    invitations: List = Field(default_factory=list)
    is_paying: Optional[bool] = None


class CreateOrganization(BaseModel):
    name: str
    owner: str
    description: Optional[str] = None
    type: Optional[str] = None


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    updated_at: Optional[str] = None


class OrganizationOutput(BaseModel):
    id: str
    name: str
