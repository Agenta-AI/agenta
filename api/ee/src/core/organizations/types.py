from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from typing import Optional, List, Dict, Any


# ============================================================================
# ORGANIZATION POLICIES
# ============================================================================


class OrganizationPolicy(BaseModel):
    id: UUID
    organization_id: UUID
    allowed_methods: List[str]
    invitation_only: bool
    domains_only: bool
    disable_root: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class OrganizationPolicyCreate(BaseModel):
    organization_id: UUID
    allowed_methods: List[str] = ["email:otp", "social:*"]
    invitation_only: bool = True
    domains_only: bool = False
    disable_root: bool = False


class OrganizationPolicyUpdate(BaseModel):
    allowed_methods: Optional[List[str]] = None
    invitation_only: Optional[bool] = None
    domains_only: Optional[bool] = None
    disable_root: Optional[bool] = None


# ============================================================================
# ORGANIZATION DOMAINS
# ============================================================================


class OrganizationDomain(BaseModel):
    id: UUID
    organization_id: UUID
    domain: str
    verified: bool
    verification_token: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class OrganizationDomainCreate(BaseModel):
    organization_id: UUID
    domain: str
    verification_token: Optional[str] = None


# ============================================================================
# ORGANIZATION PROVIDERS
# ============================================================================


class OrganizationProvider(BaseModel):
    id: UUID
    organization_id: UUID
    slug: str
    name: str
    description: Optional[str]
    enabled: bool
    domain_id: Optional[UUID]
    config: Dict[str, Any]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class OrganizationProviderCreate(BaseModel):
    organization_id: UUID
    slug: str
    name: str
    description: Optional[str] = None
    enabled: bool = True
    domain_id: Optional[UUID] = None
    config: Dict[str, Any]


class OrganizationProviderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    domain_id: Optional[UUID] = None
    config: Optional[Dict[str, Any]] = None


# ============================================================================
# ORGANIZATION INVITATIONS
# ============================================================================


class OrganizationInvitation(BaseModel):
    id: UUID
    organization_id: UUID
    email: str
    role: str
    token: str
    status: str
    expires_at: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class OrganizationInvitationCreate(BaseModel):
    organization_id: UUID
    email: str
    role: str
    token: str
    expires_at: Optional[datetime] = None
