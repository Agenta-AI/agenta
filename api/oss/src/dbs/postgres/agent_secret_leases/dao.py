from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils
from sqlalchemy import func, or_, select, tuple_, update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

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
    LeaseState,
    LeaseTransition,
    ResourceState,
)
from oss.src.dbs.postgres.agent_secret_leases.dbes import (
    AgentSecretLeaseDBE,
    AgentSecretLeaseResourceDBE,
)
from oss.src.dbs.postgres.agent_secret_leases.mappings import lease_dbe_to_dto
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


class AgentSecretLeasesDAO(AgentSecretLeasesDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    @staticmethod
    def _scope(stmt, scope: TenantScope):
        return stmt.where(
            AgentSecretLeaseDBE.organization_id == scope.organization_id,
            AgentSecretLeaseDBE.workspace_id == scope.workspace_id,
            AgentSecretLeaseDBE.project_id == scope.project_id,
        )

    @staticmethod
    def _provider_secret_name(lease_id: UUID, resource_id: UUID, ordinal: int) -> str:
        return f"agenta_lease_{lease_id.hex}_{ordinal}_{resource_id.hex[-8:]}"

    async def reserve(
        self,
        *,
        scope: TenantScope,
        lease_id: UUID,
        plan_digest: str,
        sandbox_label: str,
        reservation: LeaseReserve,
    ) -> AgentSecretLease:
        async def existing_or_none(session):
            stmt = (
                select(AgentSecretLeaseDBE)
                .options(selectinload(AgentSecretLeaseDBE.resources))
                .where(
                    AgentSecretLeaseDBE.organization_id == scope.organization_id,
                    AgentSecretLeaseDBE.project_id == scope.project_id,
                    AgentSecretLeaseDBE.idempotency_key == reservation.idempotency_key,
                )
            )
            return (await session.execute(stmt)).scalar_one_or_none()

        try:
            async with self.engine.session() as session:
                existing = await existing_or_none(session)
                if existing is not None:
                    if (
                        existing.plan_digest != plan_digest
                        or existing.credential_epoch_digest
                        != reservation.credential_epoch_digest
                    ):
                        raise LeaseConflict(
                            "idempotency_collision", current_version=existing.version
                        )
                    return lease_dbe_to_dto(existing)

                now = datetime.now(timezone.utc)
                lease = AgentSecretLeaseDBE(
                    id=lease_id,
                    organization_id=scope.organization_id,
                    workspace_id=scope.workspace_id,
                    project_id=scope.project_id,
                    created_by_id=scope.user_id,
                    provider="daytona",
                    owner_kind=reservation.owner.kind.value,
                    owner_id=reservation.owner.id,
                    idempotency_key=reservation.idempotency_key,
                    plan_digest=plan_digest,
                    credential_epoch_digest=reservation.credential_epoch_digest,
                    sandbox_fingerprint=reservation.sandbox_fingerprint,
                    sandbox_label=sandbox_label,
                    state=LeaseState.RESERVED.value,
                    version=1,
                    attempt_count=0,
                    claim_generation=0,
                    created_at=now,
                )
                for ordinal, plan in enumerate(reservation.resources):
                    resource_id = uuid_utils.uuid7()
                    lease.resources.append(
                        AgentSecretLeaseResourceDBE(
                            id=resource_id,
                            lease_id=lease_id,
                            organization_id=scope.organization_id,
                            workspace_id=scope.workspace_id,
                            project_id=scope.project_id,
                            provider="daytona",
                            ordinal=ordinal,
                            consumer_kind=plan.consumer.kind.value,
                            consumer_key=plan.consumer.key,
                            binding_kind=plan.binding.kind.value,
                            binding_name=plan.binding.name,
                            usage=plan.usage.value,
                            allowed_host=plan.allowed_host,
                            provider_secret_name=self._provider_secret_name(
                                lease_id, resource_id, ordinal
                            ),
                            state=ResourceState.PLANNED.value,
                            version=1,
                            created_at=now,
                        )
                    )
                session.add(lease)
                await session.flush()
                return lease_dbe_to_dto(lease)
        except IntegrityError:
            async with self.engine.session() as session:
                existing = await existing_or_none(session)
                if existing is None:
                    raise
                if (
                    existing.plan_digest != plan_digest
                    or existing.credential_epoch_digest
                    != reservation.credential_epoch_digest
                ):
                    raise LeaseConflict(
                        "idempotency_collision", current_version=existing.version
                    )
                return lease_dbe_to_dto(existing)

    async def fetch(
        self, *, lease_id: UUID, scope: Optional[TenantScope]
    ) -> Optional[AgentSecretLease]:
        async with self.engine.session() as session:
            stmt = (
                select(AgentSecretLeaseDBE)
                .options(selectinload(AgentSecretLeaseDBE.resources))
                .where(AgentSecretLeaseDBE.id == lease_id)
            )
            if scope is not None:
                stmt = self._scope(stmt, scope)
            lease = (await session.execute(stmt)).scalar_one_or_none()
            return lease_dbe_to_dto(lease) if lease else None

    async def mutate(
        self,
        *,
        lease_id: UUID,
        scope: Optional[TenantScope],
        mutation: LeaseMutation,
        require_claim: bool,
    ) -> Optional[AgentSecretLease]:
        now = datetime.now(timezone.utc)
        async with self.engine.session() as session:
            stmt = (
                select(AgentSecretLeaseDBE)
                .options(selectinload(AgentSecretLeaseDBE.resources))
                .where(
                    AgentSecretLeaseDBE.id == lease_id,
                    AgentSecretLeaseDBE.version == mutation.expected_version,
                )
                .with_for_update()
            )
            if scope is not None:
                stmt = self._scope(stmt, scope)
            lease = (await session.execute(stmt)).scalar_one_or_none()
            if lease is None:
                return None
            if require_claim and (
                mutation.claim is None
                or lease.claim_id != mutation.claim.id
                or lease.claim_generation != mutation.claim.generation
                or lease.claim_expires_at is None
                or lease.claim_expires_at <= now
            ):
                return None

            resources = {resource.id: resource for resource in lease.resources}
            for update in mutation.resource_updates:
                resource = resources.get(update.resource_id)
                if resource is None or resource.version != update.expected_version:
                    return None
                if update.state == ResourceState.CREATED and not (
                    update.provider_secret_id or resource.provider_secret_id
                ):
                    raise LeaseConflict(
                        "provider_secret_id_required", current_version=lease.version
                    )
            for update in mutation.resource_updates:
                resource = resources[update.resource_id]
                if update.provider_secret_id is not None:
                    resource.provider_secret_id = update.provider_secret_id
                resource.state = update.state.value
                resource.version += 1
                resource.updated_at = now
                if update.state == ResourceState.DELETED:
                    resource.deleted_at = now

            transition = mutation.transition
            if mutation.sandbox_id is not None:
                lease.sandbox_id = mutation.sandbox_id
            if transition == LeaseTransition.BEGIN_PROVISIONING:
                lease.state = LeaseState.PROVISIONING.value
            elif transition == LeaseTransition.ACTIVATE:
                lease.state = LeaseState.ACTIVE.value
                lease.activated_at = now
            elif transition == LeaseTransition.REQUEST_CLEANUP:
                lease.state = LeaseState.CLEANUP_PENDING.value
                lease.cleanup_requested_at = lease.cleanup_requested_at or now
            elif transition == LeaseTransition.BEGIN_CLEANUP:
                lease.state = LeaseState.CLEANING.value
            elif transition == LeaseTransition.RECORD_RETRY:
                lease.state = LeaseState.CLEANUP_PENDING.value
                lease.attempt_count += 1
                lease.next_attempt_at = mutation.next_attempt_at
                lease.last_error_code = (
                    mutation.error_code.value if mutation.error_code else None
                )
                lease.last_error_at = now
                lease.claim_id = None
                lease.claim_owner = None
                lease.claim_expires_at = None
            elif transition == LeaseTransition.MARK_DELETED:
                lease.state = LeaseState.DELETED.value
                lease.sandbox_id = None
                lease.deleted_at = now
                lease.claim_id = None
                lease.claim_owner = None
                lease.claim_expires_at = None
            elif transition == LeaseTransition.QUARANTINE:
                lease.state = LeaseState.QUARANTINED.value
                lease.last_error_code = (
                    mutation.error_code.value if mutation.error_code else None
                )
                lease.last_error_at = (
                    now if mutation.error_code else lease.last_error_at
                )
            lease.version += 1
            lease.updated_at = now
            await session.flush()
            return lease_dbe_to_dto(lease)

    async def query(
        self, *, scope: Optional[TenantScope], query: LeaseQuery
    ) -> LeasePage:
        async with self.engine.session() as session:
            sort_time = func.coalesce(
                AgentSecretLeaseDBE.next_attempt_at, AgentSecretLeaseDBE.created_at
            )
            stmt = (
                select(AgentSecretLeaseDBE)
                .options(selectinload(AgentSecretLeaseDBE.resources))
                .where(AgentSecretLeaseDBE.provider == query.provider.value)
            )
            if scope is not None:
                stmt = self._scope(stmt, scope)
            elif query.organization_id is not None:
                stmt = stmt.where(
                    AgentSecretLeaseDBE.organization_id == query.organization_id
                )
            if query.states:
                stmt = stmt.where(
                    AgentSecretLeaseDBE.state.in_(
                        [state.value for state in query.states]
                    )
                )
            if query.retry_before is not None:
                stmt = stmt.where(
                    AgentSecretLeaseDBE.next_attempt_at <= query.retry_before
                )
            if query.owner is not None:
                stmt = stmt.where(
                    AgentSecretLeaseDBE.owner_kind == query.owner.kind.value,
                    AgentSecretLeaseDBE.owner_id == query.owner.id,
                )
            if query.windowing.next:
                anchor_stmt = select(AgentSecretLeaseDBE).where(
                    AgentSecretLeaseDBE.id == UUID(str(query.windowing.next))
                )
                if scope is not None:
                    anchor_stmt = self._scope(anchor_stmt, scope)
                if query.organization_id is not None and scope is None:
                    anchor_stmt = anchor_stmt.where(
                        AgentSecretLeaseDBE.organization_id == query.organization_id
                    )
                anchor = (await session.execute(anchor_stmt)).scalar_one_or_none()
                if anchor is None:
                    raise LeaseInvalid("invalid_cursor")
                anchor_time = anchor.next_attempt_at or anchor.created_at
                stmt = stmt.where(
                    tuple_(sort_time, AgentSecretLeaseDBE.id)
                    > tuple_(anchor_time, anchor.id)
                )
            limit = min(max(query.windowing.limit or 100, 1), 200)
            stmt = stmt.order_by(sort_time.asc(), AgentSecretLeaseDBE.id.asc()).limit(
                limit
            )
            leases = (await session.execute(stmt)).scalars().unique().all()
            return LeasePage(
                leases=[lease_dbe_to_dto(lease) for lease in leases],
                next_cursor=leases[-1].id if len(leases) == limit else None,
            )

    async def claim(
        self,
        *,
        lease_id: UUID,
        claim_owner: str,
        claim_expires_at: datetime,
    ) -> Optional[LeaseClaim]:
        now = datetime.now(timezone.utc)
        claim_id = uuid_utils.uuid7()
        async with self.engine.session() as session:
            stmt = (
                sa_update(AgentSecretLeaseDBE)
                .where(
                    AgentSecretLeaseDBE.id == lease_id,
                    AgentSecretLeaseDBE.state.in_(
                        (LeaseState.CLEANUP_PENDING.value, LeaseState.CLEANING.value)
                    ),
                    or_(
                        AgentSecretLeaseDBE.claim_expires_at.is_(None),
                        AgentSecretLeaseDBE.claim_expires_at <= now,
                    ),
                )
                .values(
                    claim_id=claim_id,
                    claim_owner=claim_owner,
                    claim_expires_at=claim_expires_at,
                    claim_generation=AgentSecretLeaseDBE.claim_generation + 1,
                    updated_at=now,
                )
                .returning(AgentSecretLeaseDBE.claim_generation)
            )
            generation = (await session.execute(stmt)).scalar_one_or_none()
            if generation is None:
                return None
            return LeaseClaim(
                claim_id=claim_id,
                claim_generation=generation,
                claim_expires_at=claim_expires_at,
            )
