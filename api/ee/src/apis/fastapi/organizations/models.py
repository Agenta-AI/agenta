"""API models for organization security features (domains and SSO providers)."""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


# Domain Verification Models
class OrganizationDomainCreate(BaseModel):
    """Request model for creating a domain."""

    domain: str = Field(..., description="Domain name to verify (e.g., 'company.com')")
    name: Optional[str] = Field(None, description="Friendly name for the domain")
    description: Optional[str] = Field(None, description="Optional description")


class OrganizationDomainVerify(BaseModel):
    """Request model for verifying a domain."""

    domain_id: str = Field(..., description="ID of the domain to verify")


class OrganizationDomainResponse(BaseModel):
    """Response model for a domain."""

    id: str
    organization_id: str
    slug: str  # The actual domain (e.g., "company.com")
    name: Optional[str]
    description: Optional[str]
    token: Optional[str]  # Verification token
    flags: dict  # Contains is_verified flag
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# SSO Provider Models
class OrganizationProviderCreate(BaseModel):
    """Request model for creating an SSO provider."""

    slug: str = Field(
        ...,
        description="Provider slug (lowercase letters and hyphens only)",
        pattern="^[a-z-]+$",
    )
    name: Optional[str] = Field(None, description="Friendly name for the provider")
    description: Optional[str] = Field(None, description="Optional description")
    settings: dict = Field(
        ...,
        description="Provider settings (client_id, client_secret, issuer_url, scopes)",
    )
    flags: Optional[dict] = Field(
        default=None, description="Provider flags (is_active, is_valid)"
    )


class OrganizationProviderUpdate(BaseModel):
    """Request model for updating an SSO provider."""

    slug: Optional[str] = Field(None, description="Provider slug", pattern="^[a-z-]+$")
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict] = None
    flags: Optional[dict] = None


class OrganizationProviderResponse(BaseModel):
    """Response model for an SSO provider."""

    id: str
    organization_id: str
    slug: str  # Provider identifier
    name: Optional[str]
    description: Optional[str]
    settings: dict  # Contains client_id, client_secret, issuer_url, scopes
    flags: dict  # Contains is_valid, is_active
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True
