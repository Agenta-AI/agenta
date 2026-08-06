from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ============================================================================
# ORGANIZATION DOMAINS
# ============================================================================


class OrganizationDomain(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
    model_config = ConfigDict(from_attributes=True)

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
    slug: Optional[str] = None

    name: Optional[str] = None
    description: Optional[str] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    settings: Optional[Dict[str, Any]] = None
