from uuid import UUID

from oss.src.core.access.interfaces import RbacEnforcementInterface


class AlwaysEnforcedRbac(RbacEnforcementInterface):
    """OSS: role checks always apply."""

    async def is_enforced(self, *, organization_id: UUID) -> bool:
        return True
