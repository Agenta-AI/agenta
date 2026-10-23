from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from oss.src.core.access.dtos import PrincipalRecord, PrincipalRef


class RbacEnforcementInterface(ABC):
    """Whether role checks apply in an organization. OSS: always. EE: only when the
    organization's plan has the RBAC entitlement."""

    @abstractmethod
    async def is_enforced(self, *, organization_id: UUID) -> bool: ...


class PrincipalsDAOInterface(ABC):
    """Reads the record behind a principal: whether it is active, its project (for a key
    or a binding) and the user whose role it uses. `None` when no such principal
    exists."""

    @abstractmethod
    async def fetch_principal(
        self,
        *,
        principal: PrincipalRef,
    ) -> Optional[PrincipalRecord]: ...
