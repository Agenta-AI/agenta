from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from typing import Sequence

from oss.src.core.access.dtos import (
    PrincipalRecord,
    PrincipalRef,
    ScopePrincipals,
    UserPrincipals,
)


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

    async def list_user_principals(self, *, user_id: UUID) -> UserPrincipals:
        """The keys, bindings and projects of a user, for the invalidation after a user
        deletion. One statement in Postgres. The default knows none."""

        return UserPrincipals(user_id=user_id)

    async def list_scope_principals(
        self,
        *,
        organization_ids: Sequence[UUID] = (),
        workspace_ids: Sequence[UUID] = (),
        project_ids: Sequence[UUID] = (),
    ) -> ScopePrincipals:
        """The projects of these scopes and the keys and bindings in them, for the
        invalidation after a cascade delete. The default knows none."""

        return ScopePrincipals(project_ids=list(project_ids))

    async def invalidate_principal(self, *, principal: PrincipalRef) -> Optional[bool]:
        """Clear the cached record of a principal. Returns `None` when the delete
        failed. The default caches nothing."""

        return True
