from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, alias_generators

from oss.src.core.agent_secret_leases.dtos import AgentSecretLease
from oss.src.core.agent_secret_leases.types import (
    BindingKind,
    ConsumerKind,
    CredentialUsage,
    LeaseProvider,
    LeaseState,
    LeaseTransition,
    OwnerKind,
    ResourceState,
    SafeErrorCode,
)
from oss.src.core.shared.dtos import Windowing


class APIModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        alias_generator=alias_generators.to_camel,
    )


class OwnerRequest(APIModel):
    kind: OwnerKind
    id: str = Field(min_length=1, max_length=255)


class ConsumerRequest(APIModel):
    kind: ConsumerKind
    key: Optional[str] = Field(default=None, min_length=1, max_length=128)


class BindingRequest(APIModel):
    kind: BindingKind
    name: str = Field(min_length=1, max_length=255)


class ResourcePlanRequest(APIModel):
    consumer: ConsumerRequest
    binding: BindingRequest
    usage: CredentialUsage
    allowed_host: str = Field(min_length=1, max_length=253)


class LeaseReserveRequest(APIModel):
    owner: OwnerRequest
    idempotency_key: str = Field(min_length=16, max_length=255)
    credential_epoch_digest: str = Field(pattern=r"^hmac-sha256:[0-9a-f]{64}$")
    sandbox_fingerprint: Optional[str] = Field(default=None, max_length=255)
    resources: List[ResourcePlanRequest] = Field(min_length=1, max_length=128)


class ClaimFenceRequest(APIModel):
    id: UUID
    generation: int = Field(ge=1)


class ResourceUpdateRequest(APIModel):
    resource_id: UUID
    expected_version: int = Field(ge=1)
    provider_secret_id: Optional[str] = Field(default=None, max_length=255)
    state: ResourceState


class LeaseMutationRequest(APIModel):
    expected_version: int = Field(ge=1)
    transition: LeaseTransition
    claim: Optional[ClaimFenceRequest] = None
    sandbox_id: Optional[str] = Field(default=None, max_length=255)
    resource_updates: List[ResourceUpdateRequest] = Field(
        default_factory=list, max_length=128
    )
    next_attempt_at: Optional[datetime] = None
    error_code: Optional[SafeErrorCode] = None


class LeaseQueryRequest(APIModel):
    provider: LeaseProvider = LeaseProvider.DAYTONA
    states: List[LeaseState] = Field(default_factory=list)
    retry_before: Optional[datetime] = None
    owner: Optional[OwnerRequest] = None
    organization_id: Optional[UUID] = None
    windowing: Windowing = Field(default_factory=lambda: Windowing(limit=100))


class LeaseClaimRequest(APIModel):
    claim_owner: str = Field(min_length=1, max_length=255)
    ttl_seconds: int = Field(default=60, ge=5, le=900)


class LeaseResponse(APIModel):
    count: int
    lease: Optional[AgentSecretLease] = None


class LeasesResponse(APIModel):
    count: int
    leases: List[AgentSecretLease]
    windowing: Optional[Windowing] = None


class ClaimResponse(APIModel):
    claim_id: UUID
    claim_generation: int
    claim_expires_at: datetime
