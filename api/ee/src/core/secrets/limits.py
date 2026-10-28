"""The project limit of organization credentials in EE: the RBAC entitlement decides."""

from uuid import UUID

from oss.src.core.access.interfaces import RbacEnforcementInterface
from oss.src.core.secrets.interfaces import ProjectLimitsInterface


class EntitlementProjectLimits(ProjectLimitsInterface):
    """EE: limiting a credential to selected projects needs `Flag.RBAC` (no new plan flag).

    Reuses the access layer's entitlement check, with its process memo."""

    def __init__(self, *, rbac: RbacEnforcementInterface):
        self.rbac = rbac

    async def allows_selected_projects(self, *, organization_id: UUID) -> bool:
        return bool(await self.rbac.is_enforced(organization_id=organization_id))
