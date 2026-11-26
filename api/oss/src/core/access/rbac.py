from uuid import UUID

from oss.src.core.access.interfaces import RbacEntitlementInterface


class NoRbacEntitlement(RbacEntitlementInterface):
    """OSS: no plan, so the short role list. Roles still apply."""

    async def is_entitled(self, *, organization_id: UUID) -> bool:
        return False
