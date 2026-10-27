"""`AccessService.role_allows`: what a "Can send" grant can do for a member's role (QA D3).

A grant gives send access only to a member whose role may run sessions (rule S2 AND the
capability step of `decide`). The share dialog shows it per member from this answer.
"""

from uuid import uuid4

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO
from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy


def _service(*, enforced: bool) -> AccessService:
    return AccessService(
        memberships=MembershipsService(
            memberships_dao=InMemoryMembershipsDAO(),
            policy=MembershipPolicy.PROJECT_ROWS,
        ),
        rbac=RecordingRbac(enforced=enforced),
        principals=InMemoryPrincipalsDAO(),
        resource_policy=AllowAllResourcePolicy(),
    )


@pytest.mark.parametrize(
    "role, allowed",
    [
        ("viewer", False),
        ("editor", True),
        ("admin", True),
        ("owner", True),
        (None, False),
    ],
)
async def test_a_role_may_send_or_not_with_rbac(role, allowed):
    service = _service(enforced=True)
    assert (
        await service.role_allows(
            organization_id=uuid4(), role=role, action=Permission.RUN_SESSIONS
        )
        is allowed
    )


async def test_without_rbac_every_member_may_send():
    service = _service(enforced=False)
    assert await service.role_allows(
        organization_id=uuid4(), role="viewer", action=Permission.RUN_SESSIONS
    )
