from uuid import UUID

from ee.src.core.access.entitlements.service import (
    Flag,
    check_entitlements,
    scope_from,
)
from oss.src.core.access.interfaces import RbacEnforcementInterface


class EntitlementsRbacEnforcement(RbacEnforcementInterface):
    """EE: role checks apply only when the organization's plan has the RBAC
    entitlement. Without it every member passes, as before."""

    async def is_enforced(self, *, organization_id: UUID) -> bool:
        check, _, _ = await check_entitlements(
            key=Flag.RBAC,
            scope=scope_from(organization_id=organization_id),
        )
        return bool(check)
