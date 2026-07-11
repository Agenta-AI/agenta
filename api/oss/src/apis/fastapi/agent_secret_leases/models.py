from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, alias_generators, model_validator

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
from oss.src.core.agent_secret_leases.dtos import AgentSecretLease


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
    provider_secret_id: Optional[str] = Field(
        default=None, min_length=1, max_length=255
    )
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


class LeaseWindowing(APIModel):
    next: Optional[str] = Field(default=None, min_length=1, max_length=255)
    limit: Optional[int] = Field(default=100, ge=1, le=200)


class LeaseQueryRequest(APIModel):
    provider: LeaseProvider = LeaseProvider.DAYTONA
    states: List[LeaseState] = Field(default_factory=list)
    retry_before: Optional[datetime] = None
    owner: Optional[OwnerRequest] = None
    organization_id: Optional[UUID] = None
    windowing: LeaseWindowing = Field(default_factory=LeaseWindowing)


class LeaseClaimRequest(APIModel):
    claim_owner: str = Field(min_length=1, max_length=255)
    ttl_seconds: int = Field(default=60, ge=5, le=900)


class ConsumerResponse(APIModel):
    kind: ConsumerKind
    key: Optional[str] = None

    @model_validator(mode="after")
    def validate_key(self) -> "ConsumerResponse":
        if self.kind == ConsumerKind.MODEL and self.key is not None:
            raise ValueError("model consumer cannot carry a key")
        if self.kind == ConsumerKind.HTTP_MCP and self.key is None:
            raise ValueError("http_mcp consumer requires a stable key")
        return self


class BindingResponse(APIModel):
    kind: BindingKind
    name: str


class LeaseResourceResponse(APIModel):
    id: UUID
    version: int
    ordinal: int
    consumer: ConsumerResponse
    binding: BindingResponse
    usage: CredentialUsage
    allowed_host: str
    provider_secret_name: str
    provider_secret_id: Optional[str] = None
    state: ResourceState


class LeaseFenceResponse(APIModel):
    id: UUID
    generation: int
    expires_at: datetime


class AgentSecretLeaseResponse(APIModel):
    id: UUID
    version: int
    state: LeaseState
    owner: OwnerRequest
    credential_epoch_digest: str
    sandbox_id: Optional[str] = None
    sandbox_label: str
    claim: Optional[LeaseFenceResponse] = None
    resources: List[LeaseResourceResponse] = Field(default_factory=list)

    @classmethod
    def from_core(cls, lease: AgentSecretLease) -> "AgentSecretLeaseResponse":
        claim = None
        if lease.claim_id is not None:
            if lease.claim_expires_at is None:
                raise ValueError("claimed lease is missing claim expiry")
            claim = {
                "id": lease.claim_id,
                "generation": lease.claim_generation,
                "expires_at": lease.claim_expires_at,
            }
        return cls.model_validate(
            {
                "id": lease.id,
                "version": lease.version,
                "state": lease.state,
                "owner": {"kind": lease.owner_kind, "id": lease.owner_id},
                "credential_epoch_digest": lease.credential_epoch_digest,
                "sandbox_id": lease.sandbox_id,
                "sandbox_label": lease.sandbox_label,
                "claim": claim,
                "resources": [
                    {
                        "id": resource.id,
                        "version": resource.version,
                        "ordinal": resource.ordinal,
                        "consumer": {
                            "kind": resource.consumer_kind,
                            "key": resource.consumer_key,
                        },
                        "binding": {
                            "kind": resource.binding_kind,
                            "name": resource.binding_name,
                        },
                        "usage": resource.usage,
                        "allowed_host": resource.allowed_host,
                        "provider_secret_name": resource.provider_secret_name,
                        "provider_secret_id": resource.provider_secret_id,
                        "state": resource.state,
                    }
                    for resource in lease.resources
                ],
            }
        )


class LeasesResponse(APIModel):
    count: int
    leases: List[AgentSecretLeaseResponse]
    windowing: Optional[LeaseWindowing] = None


class ClaimResponse(APIModel):
    claim_id: UUID
    claim_generation: int
    claim_expires_at: datetime
