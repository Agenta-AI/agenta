from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from uuid import UUID

from oss.src.core.agent_secret_leases.dtos import (
    AgentSecretLease,
    LeaseClaim,
    LeaseMutation,
    LeasePage,
    LeaseQuery,
    LeaseReserve,
    TenantScope,
)


class AgentSecretLeasesDAOInterface(ABC):
    @abstractmethod
    async def reserve(
        self,
        *,
        scope: TenantScope,
        lease_id: UUID,
        plan_digest: str,
        sandbox_label: str,
        reservation: LeaseReserve,
    ) -> AgentSecretLease: ...

    @abstractmethod
    async def fetch(
        self,
        *,
        lease_id: UUID,
        scope: Optional[TenantScope],
    ) -> Optional[AgentSecretLease]: ...

    @abstractmethod
    async def mutate(
        self,
        *,
        lease_id: UUID,
        scope: Optional[TenantScope],
        mutation: LeaseMutation,
        require_claim: bool,
    ) -> Optional[AgentSecretLease]: ...

    @abstractmethod
    async def query(
        self,
        *,
        scope: Optional[TenantScope],
        query: LeaseQuery,
    ) -> LeasePage: ...

    @abstractmethod
    async def claim(
        self,
        *,
        lease_id: UUID,
        claim_owner: str,
        claim_expires_at: datetime,
    ) -> Optional[LeaseClaim]: ...
