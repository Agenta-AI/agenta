"""API models for organization security features (domains and SSO providers)."""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


# Domain Verification Models
class OrganizationDomainCreate(BaseModel):
    """Request model for creating a domain."""

    domain: str = Field(..., description="Domain name to verify (e.g., 'company.com')")
    name: str = Field(..., description="Friendly name for the domain")
    description: Optional[str] = Field(None, description="Optional description")


class OrganizationDomainVerify(BaseModel):
    """Request model for verifying a domain."""

    domain_id: str = Field(..., description="ID of the domain to verify")


class OrganizationDomainResponse(BaseModel):
    """Response model for a domain."""

    id: str
    organization_id: str
    slug: str  # The actual domain (e.g., "company.com")
    name: str
    description: Optional[str]
    token: Optional[str]  # Verification token
    is_verified: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# SSO Provider Models
class OrganizationProviderCreate(BaseModel):
    """Request model for creating an SSO provider."""

    provider_type: str = Field(..., description="Type of SSO provider (e.g., 'oidc', 'saml')")
    name: str = Field(..., description="Friendly name for the provider")
    client_id: str = Field(..., description="OAuth/OIDC client ID")
    client_secret: str = Field(..., description="OAuth/OIDC client secret")
    issuer_url: str = Field(..., description="OIDC issuer URL or SAML IdP URL")
    authorization_endpoint: Optional[str] = Field(None, description="Authorization endpoint URL")
    token_endpoint: Optional[str] = Field(None, description="Token endpoint URL")
    userinfo_endpoint: Optional[str] = Field(None, description="Userinfo endpoint URL")
    scopes: Optional[list[str]] = Field(default=["openid", "profile", "email"], description="OAuth scopes")


class OrganizationProviderUpdate(BaseModel):
    """Request model for updating an SSO provider."""

    name: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    issuer_url: Optional[str] = None
    authorization_endpoint: Optional[str] = None
    token_endpoint: Optional[str] = None
    userinfo_endpoint: Optional[str] = None
    scopes: Optional[list[str]] = None
    is_active: Optional[bool] = None


class OrganizationProviderResponse(BaseModel):
    """Response model for an SSO provider."""

    id: str
    organization_id: str
    slug: str  # Provider identifier
    provider_type: str
    name: str
    client_id: str
    client_secret: str  # Masked in actual responses
    issuer_url: str
    authorization_endpoint: Optional[str]
    token_endpoint: Optional[str]
    userinfo_endpoint: Optional[str]
    scopes: list[str]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True
