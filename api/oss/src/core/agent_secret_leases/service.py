from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils

from oss.src.core.agent_secret_leases.dtos import (
    AgentSecretLease,
    LeaseClaim,
    LeaseMutation,
    LeasePage,
    LeaseQuery,
    LeaseReserve,
    TenantScope,
)
from oss.src.core.agent_secret_leases.interfaces import AgentSecretLeasesDAOInterface
from oss.src.core.agent_secret_leases.types import (
    LeaseConflict,
    LeaseInvalid,
    LeaseNotFound,
    LeaseState,
    LeaseTransition,
    ResourceState,
)


_ALLOWED_SOURCE_STATES = {
    LeaseTransition.BEGIN_PROVISIONING: {LeaseState.RESERVED},
    LeaseTransition.RECORD_SANDBOX: {LeaseState.PROVISIONING},
    LeaseTransition.ACTIVATE: {LeaseState.PROVISIONING},
    LeaseTransition.REQUEST_CLEANUP: {
        LeaseState.RESERVED,
        LeaseState.PROVISIONING,
        LeaseState.ACTIVE,
        LeaseState.CLEANING,
    },
    LeaseTransition.BEGIN_CLEANUP: {LeaseState.CLEANUP_PENDING},
    LeaseTransition.RECORD_RETRY: {LeaseState.CLEANING},
    LeaseTransition.MARK_DELETED: {LeaseState.CLEANING},
    LeaseTransition.QUARANTINE: {
        LeaseState.RESERVED,
        LeaseState.PROVISIONING,
        LeaseState.ACTIVE,
        LeaseState.CLEANUP_PENDING,
        LeaseState.CLEANING,
    },
}


def compute_plan_digest(reservation: LeaseReserve) -> str:
    shape = {
        "provider": "daytona",
        "owner": reservation.owner.model_dump(mode="json"),
        "sandboxFingerprint": reservation.sandbox_fingerprint,
        "resources": [
            resource.model_dump(mode="json") for resource in reservation.resources
        ],
    }
    encoded = json.dumps(shape, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_mutation(
    lease: AgentSecretLease,
    mutation: LeaseMutation,
    *,
    require_claim: bool,
) -> None:
    if lease.version != mutation.expected_version:
        raise LeaseConflict("stale_version", current_version=lease.version)
    if lease.state not in _ALLOWED_SOURCE_STATES[mutation.transition]:
        raise LeaseInvalid("invalid_transition")
    if require_claim:
        now = datetime.now(timezone.utc)
        if (
            mutation.claim is None
            or lease.claim_id != mutation.claim.id
            or lease.claim_generation != mutation.claim.generation
            or lease.claim_expires_at is None
            or lease.claim_expires_at <= now
        ):
            raise LeaseConflict("stale_claim", current_version=lease.version)
    elif mutation.claim is not None:
        raise LeaseInvalid("claim_not_allowed")

    transition = mutation.transition
    if transition == LeaseTransition.BEGIN_PROVISIONING:
        if any(
            (
                mutation.sandbox_id,
                mutation.resource_updates,
                mutation.next_attempt_at,
                mutation.error_code,
            )
        ):
            raise LeaseInvalid("unexpected_transition_fields")
    elif transition == LeaseTransition.RECORD_SANDBOX:
        if (
            not mutation.sandbox_id
            or mutation.resource_updates
            or mutation.next_attempt_at
            or mutation.error_code
        ):
            raise LeaseInvalid("invalid_record_sandbox")
    elif transition == LeaseTransition.ACTIVATE:
        sandbox_id = mutation.sandbox_id or lease.sandbox_id
        projected = {resource.id: resource.state for resource in lease.resources}
        for update in mutation.resource_updates:
            projected[update.resource_id] = update.state
        if (
            not sandbox_id
            or not projected
            or any(state != ResourceState.CREATED for state in projected.values())
        ):
            raise LeaseInvalid("activation_incomplete")
        if mutation.next_attempt_at or mutation.error_code:
            raise LeaseInvalid("unexpected_transition_fields")
    elif transition in (LeaseTransition.REQUEST_CLEANUP, LeaseTransition.BEGIN_CLEANUP):
        if (
            mutation.sandbox_id
            or mutation.resource_updates
            or mutation.next_attempt_at
            or mutation.error_code
        ):
            raise LeaseInvalid("unexpected_transition_fields")
    elif transition == LeaseTransition.RECORD_RETRY:
        if (
            not mutation.next_attempt_at
            or not mutation.error_code
            or mutation.sandbox_id
            or mutation.resource_updates
        ):
            raise LeaseInvalid("invalid_retry")
    elif transition == LeaseTransition.MARK_DELETED:
        projected = {resource.id: resource.state for resource in lease.resources}
        for update in mutation.resource_updates:
            projected[update.resource_id] = update.state
        if any(state != ResourceState.DELETED for state in projected.values()):
            raise LeaseInvalid("deletion_incomplete")
        if mutation.sandbox_id or mutation.next_attempt_at or mutation.error_code:
            raise LeaseInvalid("unexpected_transition_fields")
    elif transition == LeaseTransition.QUARANTINE:
        if mutation.sandbox_id or mutation.resource_updates or mutation.next_attempt_at:
            raise LeaseInvalid("unexpected_transition_fields")


class AgentSecretLeasesService:
    def __init__(self, *, leases_dao: AgentSecretLeasesDAOInterface):
        self.leases_dao = leases_dao

    async def reserve(
        self,
        *,
        scope: TenantScope,
        reservation: LeaseReserve,
    ) -> AgentSecretLease:
        lease_id = uuid_utils.uuid7()
        return await self.leases_dao.reserve(
            scope=scope,
            lease_id=lease_id,
            plan_digest=compute_plan_digest(reservation),
            sandbox_label=f"agenta.lease_id={lease_id}",
            reservation=reservation,
        )

    async def retrieve(
        self,
        *,
        lease_id: UUID,
        scope: TenantScope,
    ) -> AgentSecretLease:
        lease = await self.leases_dao.fetch(lease_id=lease_id, scope=scope)
        if lease is None:
            raise LeaseNotFound()
        return lease

    async def mutate(
        self,
        *,
        lease_id: UUID,
        scope: Optional[TenantScope],
        mutation: LeaseMutation,
        janitor: bool = False,
    ) -> AgentSecretLease:
        lease = await self.leases_dao.fetch(lease_id=lease_id, scope=scope)
        if lease is None:
            raise LeaseNotFound()
        validate_mutation(lease, mutation, require_claim=janitor)
        updated = await self.leases_dao.mutate(
            lease_id=lease_id,
            scope=scope,
            mutation=mutation,
            require_claim=janitor,
        )
        if updated is None:
            raise LeaseConflict("stale_version", current_version=lease.version)
        return updated

    async def query(
        self,
        *,
        scope: Optional[TenantScope],
        query: LeaseQuery,
        janitor: bool = False,
    ) -> LeasePage:
        if not janitor and scope is None:
            raise LeaseInvalid("tenant_scope_required")
        if not janitor and query.organization_id is not None:
            raise LeaseInvalid("organization_filter_not_allowed")
        return await self.leases_dao.query(scope=scope, query=query)

    async def claim(
        self,
        *,
        lease_id: UUID,
        claim_owner: str,
        ttl_seconds: int = 60,
    ) -> LeaseClaim:
        if not claim_owner or len(claim_owner) > 255 or not 5 <= ttl_seconds <= 900:
            raise LeaseInvalid("invalid_claim")
        claim = await self.leases_dao.claim(
            lease_id=lease_id,
            claim_owner=claim_owner,
            claim_expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=ttl_seconds),
        )
        if claim is None:
            raise LeaseConflict("claim_unavailable")
        return claim
