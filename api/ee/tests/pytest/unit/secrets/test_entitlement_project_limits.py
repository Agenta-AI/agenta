"""The EE project limit follows the RBAC entitlement (M5, P13)."""

from uuid import uuid4

from ee.src.core.secrets.limits import EntitlementProjectLimits


class _Rbac:
    def __init__(self, enforced):
        self.enforced = enforced
        self.calls = []

    async def is_enforced(self, *, organization_id):
        self.calls.append(organization_id)
        return self.enforced


async def test_entitlement_project_limits_follow_the_rbac_entitlement():
    organization_id = uuid4()
    for enforced in (True, False):
        rbac = _Rbac(enforced)
        limits = EntitlementProjectLimits(rbac=rbac)
        assert (
            await limits.allows_selected_projects(organization_id=organization_id)
            is enforced
        )
        assert rbac.calls == [organization_id]
