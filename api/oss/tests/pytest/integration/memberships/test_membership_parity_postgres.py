"""Bearer, the project list and the capability check agree, on real rows."""

from uuid import UUID

import pytest

from oss.src.core.access.interfaces import RbacEnforcementInterface
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import HumanPrincipalsDAO
from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy


pytestmark = [
    pytest.mark.integration,
    pytest.mark.xdist_group("memberships_global_sql"),
]

POLICIES = [MembershipPolicy.ORGANIZATION_WIDE, MembershipPolicy.PROJECT_ROWS]


@pytest.mark.parametrize("policy", POLICIES)
async def test_bearer_list_and_capability_agree(policy):
    members = {"a": "admin", "e": "editor", "v": "viewer"}
    organizations = [
        await seed_organization(members=members, projects=4) for _ in range(2)
    ]
    stray = await create_user(label="stray")
    organizations[0].extra_user_ids.append(stray)
    try:
        first, second = organizations
        # Members without some project rows.
        await execute(
            "DELETE FROM project_members WHERE user_id = :u AND project_id = :p",
            {"u": first.user_ids["e"], "p": first.project_ids[1]},
        )
        await execute(
            "DELETE FROM project_members WHERE user_id = :u AND project_id = ANY(CAST(:p AS uuid[]))",
            {"u": second.user_ids["v"], "p": second.project_ids[:3]},
        )
        # A project row without an organization row.
        await execute(
            "INSERT INTO project_members (id, user_id, project_id, role) "
            "VALUES (gen_random_uuid(), :u, :p, 'admin')",
            {"u": stray, "p": second.project_ids[0]},
        )

        dao = MembershipsDAO(engine=get_transactions_engine())
        memberships = MembershipsService(memberships_dao=dao, policy=policy)
        access = AccessService(
            memberships=memberships,
            rbac=RecordingRbac(enforced=True),
            principals=HumanPrincipalsDAO(),
            resource_policy=AllowAllResourcePolicy(),
        )

        users = {
            *[u for s in organizations for u in s.user_ids.values()],
            stray,
        }
        projects = [p for s in organizations for p in s.project_ids]
        for user in users:
            listed = {
                listing.membership.project_id
                for listing in await memberships.list_for_user(user_id=user)
            }
            for project in projects:
                member = await memberships.is_member(user_id=user, project_id=project)
                decision = await access.check_human(
                    user_id=user,
                    project_id=project,
                    action=Permission.VIEW_APPLICATIONS,
                )
                assert member == (project in listed) == decision.allowed, (
                    user,
                    project,
                    policy,
                )
        # The stray project row never makes a member.
        assert not await memberships.is_member(
            user_id=stray, project_id=second.project_ids[0]
        )
    finally:
        for seeded in organizations:
            await delete_seeded_organization(seeded)


class _NoRbacFor(RbacEnforcementInterface):
    def __init__(self, organization_ids):
        self._no_rbac = set(organization_ids)

    async def is_enforced(self, *, organization_id: UUID) -> bool:
        return organization_id not in self._no_rbac
