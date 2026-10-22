from abc import ABC, abstractmethod
from uuid import UUID


class RbacEnforcementInterface(ABC):
    """Whether role checks apply in an organization. OSS: always. EE: only when the
    organization's plan has the RBAC entitlement."""

    @abstractmethod
    async def is_enforced(self, *, organization_id: UUID) -> bool: ...
