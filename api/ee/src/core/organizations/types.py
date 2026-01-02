from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from typing import Optional, Dict, Any


# ============================================================================
# ORGANIZATION DOMAINS
# ============================================================================


class OrganizationDomain(BaseModel):
    id: UUID
    organization_id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    token: Optional[str] = None
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class OrganizationDomainCreate(BaseModel):
    organization_id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    token: Optional[str] = None
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


# ============================================================================
# ORGANIZATION PROVIDERS
# ============================================================================


class OrganizationProvider(BaseModel):
    id: UUID
    organization_id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Dict[str, Any]
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class OrganizationProviderCreate(BaseModel):
    organization_id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Dict[str, Any]
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class OrganizationProviderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
