from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


# ============================================================================
# ORGANIZATION DOMAINS
# ============================================================================


class OrganizationDomain(BaseModel):
    id: UUID
    slug: str

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    token: Optional[str] = None

    created_at: datetime
    updated_at: Optional[datetime] = None

    organization_id: UUID

    class Config:
        from_attributes = True


class OrganizationDomainCreate(BaseModel):
    slug: str

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    token: Optional[str] = None

    organization_id: UUID


# ============================================================================
# ORGANIZATION PROVIDERS
# ============================================================================


class OrganizationProvider(BaseModel):
    id: UUID
    slug: str

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    settings: Dict[str, Any]

    created_at: datetime
    updated_at: Optional[datetime] = None

    organization_id: UUID

    class Config:
        from_attributes = True


class OrganizationProviderCreate(BaseModel):
    slug: str

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    settings: Dict[str, Any]

    organization_id: UUID


class OrganizationProviderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    settings: Optional[Dict[str, Any]] = None
