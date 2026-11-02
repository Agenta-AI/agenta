"""`AccessService.role_allows`: what a "Can send" grant can do for a member's role (QA D3).

A grant gives send access only to a member whose role may run sessions (rule S2 AND the
capability step of `decide`). The share dialog shows it per member from this answer. Roles
apply on every plan, so there is no plan without RBAC that lets every role send.
"""

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService


@pytest.mark.parametrize(
    "role, allowed",
    [
        ("viewer", False),
        ("member", True),
        ("editor", True),
        ("admin", True),
        ("owner", True),
        ("not-a-role", False),
        (None, False),
    ],
)
def test_a_role_may_send_or_not(role, allowed):
    assert (
        AccessService.role_allows(role=role, action=Permission.RUN_SESSIONS) is allowed
    )
