from typing import Optional
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Domain Verification Models


class OrganizationDomainCreate(BaseModel):
    """Request model for creating a domain."""

    name: Optional[str] = None
    description: Optional[str] = None

    domain: str


class OrganizationDomainVerify(BaseModel):
    """Request model for verifying a domain."""

    domain_id: str


class OrganizationDomainResponse(BaseModel):
    """Response model for a domain."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str

    name: Optional[str]
    description: Optional[str]

    flags: dict

    token: Optional[str]

    created_at: datetime
    updated_at: Optional[datetime]

    organization_id: UUID


# SSO Provider Models


class OrganizationProviderCreate(BaseModel):
    """Request model for creating an SSO provider."""

    slug: str = Field(..., pattern="^[a-z-]+$")

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[dict] = None

    settings: dict


class OrganizationProviderUpdate(BaseModel):
    """Request model for updating an SSO provider."""

    slug: Optional[str] = Field(None, pattern="^[a-z-]+$")

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[dict] = None

    settings: Optional[dict] = None


class OrganizationProviderResponse(BaseModel):
    """Response model for an SSO provider."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str

    name: Optional[str]
    description: Optional[str]

    flags: dict

    settings: dict

    created_at: datetime
    updated_at: Optional[datetime]

    organization_id: UUID
