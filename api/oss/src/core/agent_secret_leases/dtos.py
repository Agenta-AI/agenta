from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from oss.src.core.shared.dtos import Windowing
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


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class TenantScope(StrictModel):
    organization_id: UUID
    workspace_id: UUID
    project_id: UUID
    user_id: UUID


class LeaseOwner(StrictModel):
    kind: OwnerKind
    id: str = Field(min_length=1, max_length=255)


class ResourceConsumer(StrictModel):
    kind: ConsumerKind
    key: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_key(self) -> "ResourceConsumer":
        if self.kind == ConsumerKind.MODEL and self.key is not None:
            raise ValueError("model consumer cannot carry a key")
        if self.kind == ConsumerKind.HTTP_MCP and self.key is None:
            raise ValueError("http_mcp consumer requires a stable key")
        return self


class ResourceBinding(StrictModel):
    kind: BindingKind
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if value != value.strip() or any(ord(char) < 33 for char in value):
            raise ValueError("binding name must be normalized")
        return value


class LeaseResourcePlan(StrictModel):
    consumer: ResourceConsumer
    binding: ResourceBinding
    usage: CredentialUsage
    allowed_host: str = Field(min_length=1, max_length=253)

    @field_validator("allowed_host")
    @classmethod
    def validate_allowed_host(cls, value: str) -> str:
        from oss.src.core.agent_secret_leases.types import normalize_exact_host

        normalized = normalize_exact_host(value)
        if normalized != value:
            raise ValueError("allowed_host must already be normalized")
        return value


class LeaseReserve(StrictModel):
    owner: LeaseOwner
    idempotency_key: str = Field(min_length=16, max_length=255)
    credential_epoch_digest: str = Field(pattern=r"^hmac-sha256:[0-9a-f]{64}$")
    sandbox_fingerprint: Optional[str] = Field(default=None, max_length=255)
    resources: List[LeaseResourcePlan] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_unique_bindings(self) -> "LeaseReserve":
        keys = [
            (
                resource.consumer.kind,
                resource.consumer.key or "",
                resource.binding.kind,
                resource.binding.name.lower(),
            )
            for resource in self.resources
        ]
        if len(keys) != len(set(keys)):
            raise ValueError("resource bindings must be unique")
        return self


class LeaseResource(StrictModel):
    id: UUID
    lease_id: UUID
    organization_id: UUID
    workspace_id: UUID
    project_id: UUID
    ordinal: int
    consumer_kind: ConsumerKind
    consumer_key: Optional[str] = None
    binding_kind: BindingKind
    binding_name: str
    usage: CredentialUsage
    allowed_host: str
    provider_secret_name: str
    provider_secret_id: Optional[str] = None
    state: ResourceState
    version: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


class AgentSecretLease(StrictModel):
    id: UUID
    organization_id: UUID
    workspace_id: UUID
    project_id: UUID
    created_by_id: UUID
    provider: LeaseProvider
    owner_kind: OwnerKind
    owner_id: str
    idempotency_key: str
    plan_digest: str
    credential_epoch_digest: str
    sandbox_id: Optional[str] = None
    sandbox_fingerprint: Optional[str] = None
    sandbox_label: str
    state: LeaseState
    version: int
    attempt_count: int
    next_attempt_at: Optional[datetime] = None
    last_error_code: Optional[SafeErrorCode] = None
    last_error_at: Optional[datetime] = None
    claim_id: Optional[UUID] = None
    claim_owner: Optional[str] = None
    claim_expires_at: Optional[datetime] = None
    claim_generation: int
    activated_at: Optional[datetime] = None
    cleanup_requested_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    resources: List[LeaseResource] = Field(default_factory=list)


class ResourceUpdate(StrictModel):
    resource_id: UUID
    expected_version: int = Field(ge=1)
    provider_secret_id: Optional[str] = Field(default=None, max_length=255)
    state: ResourceState


class ClaimFence(StrictModel):
    id: UUID
    generation: int = Field(ge=1)


class LeaseMutation(StrictModel):
    expected_version: int = Field(ge=1)
    transition: LeaseTransition
    claim: Optional[ClaimFence] = None
    sandbox_id: Optional[str] = Field(default=None, max_length=255)
    resource_updates: List[ResourceUpdate] = Field(default_factory=list, max_length=128)
    next_attempt_at: Optional[datetime] = None
    error_code: Optional[SafeErrorCode] = None


class LeaseQuery(StrictModel):
    provider: LeaseProvider = LeaseProvider.DAYTONA
    states: List[LeaseState] = Field(default_factory=list)
    retry_before: Optional[datetime] = None
    owner: Optional[LeaseOwner] = None
    organization_id: Optional[UUID] = None
    windowing: Windowing = Field(default_factory=lambda: Windowing(limit=100))


class LeasePage(StrictModel):
    leases: List[AgentSecretLease]
    next_cursor: Optional[UUID] = None


class LeaseClaim(StrictModel):
    claim_id: UUID
    claim_generation: int
    claim_expires_at: datetime
