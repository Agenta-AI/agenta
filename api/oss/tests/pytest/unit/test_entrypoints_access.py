import entrypoints.access as access_entrypoint
import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
from oss.src.core.access.service import get_access_service
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import get_memberships_service


def test_bootstrap_access_uses_project_rows_and_plan_rbac(monkeypatch):
    monkeypatch.setattr(access_module, "_access_service", None)
    monkeypatch.setattr(memberships_module, "_memberships_service", None)

    returned = access_entrypoint.bootstrap_access()

    assert get_access_service() is returned
    assert get_memberships_service().policy == MembershipPolicy.PROJECT_ROWS
    assert type(get_access_service().rbac_entitlement).__name__ == "PlanRbacEntitlement"
