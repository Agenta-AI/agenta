from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class Organization(BaseModel):
    id: UUID
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

    model_config = ConfigDict(from_attributes=True)


class CreateOrganization(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    #
    is_demo: bool = False
    is_personal: bool = False
    #
    owner_id: UUID


class OrganizationUpdate(BaseModel):
    slug: Optional[str] = None

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None

    updated_at: Optional[str] = None


class OrganizationOutput(BaseModel):
    id: str

    name: Optional[str] = None


class CreateCollaborativeOrganization(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
