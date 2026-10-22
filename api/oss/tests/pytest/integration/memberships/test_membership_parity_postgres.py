"""Bearer, the project list and the capability check agree, on real rows.

`test_legacy_shapes_decide_as_expected` runs the repair revision and `--apply` inside a
rolled-back transaction (`rolled_back_connection`) and reads through the real DAO on
that connection, so the shared database keeps none of the global repair.
"""

from uuid import UUID

import pytest
from sqlalchemy import text

from oss.src.core.access.interfaces import RbacEnforcementInterface
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    ConnectionEngine,
    create_user,
    delete_seeded_organization,
    delete_seeded_shapes,
    execute,
    load_revision_sql,
    rolled_back_connection,
    seed_legacy_shapes,
    seed_organization,
)
from oss.tests.pytest.utils.memberships import RecordingRbac


pytestmark = [
    pytest.mark.integration,
    pytest.mark.xdist_group("memberships_global_sql"),
]

POLICIES = [MembershipPolicy.ORGANIZATION_WIDE, MembershipPolicy.PROJECT_ROWS]


@pytest.mark.parametrize("policy", POLICIES)
async def test_bearer_list_and_capability_agree(policy):
    members = {"a": "admin", "e": "editor", "v": "viewer"}
    organizations = [
        await seed_organization(members=members, workspaces=2, projects_per_workspace=2)
        for _ in range(2)
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
            memberships=memberships, rbac=RecordingRbac(enforced=True)
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
                decision = await access.check_capability(
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


@pytest.mark.parametrize("edition", ["oss", "ee"])
async def test_legacy_shapes_decide_as_expected(edition, monkeypatch):
    import entrypoints.memberships_check as check_module

    shapes = await seed_legacy_shapes()
    p2b_org = shapes["P2b"].organization_id

    async def _rbac_enforced(organization_id):
        return organization_id != p2b_org

    monkeypatch.setattr(check_module, "_rbac_enforced", _rbac_enforced)
    monkeypatch.setattr(check_module, "is_ee", lambda: edition == "ee")

    policy = (
        MembershipPolicy.PROJECT_ROWS
        if edition == "ee"
        else MembershipPolicy.ORGANIZATION_WIDE
    )
    try:
        async with rolled_back_connection() as connection:
            # The release procedure: --apply before the upgrade, then the revision.
            await connection.execute(
                text(
                    "CREATE TEMP TABLE alembic_version_oss "
                    "(version_num varchar(32) NOT NULL) ON COMMIT DROP"
                )
            )
            await connection.execute(
                text("INSERT INTO alembic_version_oss VALUES ('oss000000043')")
            )
            await check_module.run_apply(
                organization_ids=sorted({s.organization_id for s in shapes.values()}),
                connection=connection,
            )
            for name in (
                "_DELETE_DEMO_ROWS_SQL",
                "_ADD_OWNER_ORGANIZATION_ROWS_SQL",
                "_ADD_OWNER_PROJECT_ROWS_SQL",
                "_COPY_WORKSPACE_ROLE_SQL",
            ):
                await connection.execute(
                    text(
                        load_revision_sql(
                            "oss000000044_repair_memberships_for_resolver.py", name
                        )
                    )
                )

            access = AccessService(
                memberships=MembershipsService(
                    memberships_dao=MembershipsDAO(engine=ConnectionEngine(connection)),
                    policy=policy,
                ),
                rbac=_NoRbacFor([p2b_org]),
            )

            async def allowed(shape, label, project_index=0):
                seeded = shapes[shape]
                user = seeded.owner_id if label == "owner" else seeded.user_ids[label]
                decision = await access.check_capability(
                    user_id=user,
                    project_id=seeded.project_ids[project_index],
                    action=Permission.VIEW_APPLICATIONS,
                )
                return decision.allowed

            expected = {
                ("P1", "owner", 0): (True, True),
                ("P2a", "owner", 1): (True, True),
                ("P2b", "m", 0): (True, True),
                ("P3", "m", 0): (True, True),
                ("P9", "m", 0): (False, False),
                ("P11", "m", 0): (True, False),
                ("owner_without_rows", "owner", 1): (True, True),
            }
            for (shape, label, index), (oss, ee) in expected.items():
                want = ee if edition == "ee" else oss
                assert await allowed(shape, label, index) is want, (shape, edition)

            # Membership, listing and role for the role-shaped shapes.
            memberships = access.memberships

            async def resolved(shape, label, project_index=0):
                seeded = shapes[shape]
                user = seeded.owner_id if label == "owner" else seeded.user_ids[label]
                return await memberships.resolve(
                    user_id=user, project_id=seeded.project_ids[project_index]
                )

            async def listed(shape, label):
                seeded = shapes[shape]
                user = seeded.owner_id if label == "owner" else seeded.user_ids[label]
                return {
                    listing.membership.project_id
                    for listing in await memberships.list_for_user(user_id=user)
                }

            # P6: the organization role now equals the workspace role (editor).
            p6 = await resolved("P6", "m")
            assert p6.role == "editor"
            # P7 (stale project row "viewer", organization "editor"): OSS reads the
            # organization role, EE the project row.
            assert (await resolved("P7", "m")).role == (
                "viewer" if edition == "ee" else "editor"
            )
            # P8 (no row in the second project): OSS member, EE not a member.
            p8 = await resolved("P8", "m", 1)
            assert (p8 is not None) is (edition == "oss")
            assert (shapes["P8"].project_ids[1] in await listed("P8", "m")) is (
                edition == "oss"
            )
            # P12 (two organization rows, the oldest "editor"): the oldest wins.
            if edition == "oss":
                assert (await resolved("P12", "m")).role == "editor"
            # A cross-organization workspace does not change the project's
            # organization: the member of the project's organization resolves.
            assert await resolved("cross_org_workspace", "m") is not None
            # A null-role EE row: a listed member who passes no capability check.
            null_role = await resolved("null_project_role", "m")
            if edition == "ee":
                assert null_role is not None and null_role.role is None
                assert shapes["null_project_role"].project_ids[0] in await listed(
                    "null_project_role", "m"
                )
                assert await allowed("null_project_role", "m") is False
            else:
                assert null_role.role == "editor"
                assert await allowed("null_project_role", "m") is True
    finally:
        await delete_seeded_shapes(shapes)
