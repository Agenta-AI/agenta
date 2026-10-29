import pytest

import entrypoints.access as access_entrypoint
import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
from oss.src.core.access.service import get_access_service
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import get_memberships_service


@pytest.mark.parametrize(
    "license, policy, rbac_type",
    [
        ("oss", MembershipPolicy.ORGANIZATION_WIDE, "AlwaysEnforcedRbac"),
        ("ee", MembershipPolicy.PROJECT_ROWS, "EntitlementsRbacEnforcement"),
    ],
)
def test_bootstrap_access_picks_the_policy_from_the_edition(
    license, policy, rbac_type, monkeypatch
):
    monkeypatch.setattr(access_entrypoint, "is_ee", lambda: license == "ee")
    monkeypatch.setattr(access_module, "_access_service", None)
    monkeypatch.setattr(memberships_module, "_memberships_service", None)

    returned = access_entrypoint.bootstrap_access()

    assert get_access_service() is returned
    assert get_memberships_service().policy == policy
    assert type(get_access_service().rbac).__name__ == rbac_type
