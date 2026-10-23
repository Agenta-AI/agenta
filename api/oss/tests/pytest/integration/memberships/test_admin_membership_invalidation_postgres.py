"""Admin membership writes clear the access caches, so a cached answer never outlives
the row change. The cache is `FakeAccessCache` (real `_pack` keys and patterns): the
stack's Redis is not published to the host."""

import pytest

import oss.src.core.access.service as access_module
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService
from oss.src.core.accounts.dtos import (
    AdminOrganizationMembershipCreate,
    AdminProjectMembershipCreate,
    AdminSimpleAccountsOrganizationsMembershipsCreate,
    AdminSimpleAccountsProjectsMembershipsCreate,
    EntityRef,
)
from oss.src.core.accounts.service import PlatformAdminAccountsService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    fetch_all,
    seed_organization,
)
from oss.tests.pytest.utils.memberships import FakeAccessCache
from oss.tests.pytest.utils.principals import HumanPrincipalsDAO


pytestmark = pytest.mark.integration


@pytest.fixture
def cache(monkeypatch):
    fake = FakeAccessCache().install(monkeypatch)
    policy = (
        MembershipPolicy.PROJECT_ROWS if is_ee() else MembershipPolicy.ORGANIZATION_WIDE
    )
    monkeypatch.setattr(
        access_module,
        "_access_service",
        AccessService(
            memberships=MembershipsService(
                memberships_dao=MembershipsDAO(engine=get_transactions_engine()),
                policy=policy,
            ),
            rbac=AlwaysEnforcedRbac(),
            principals=HumanPrincipalsDAO(),
        ),
    )
    return fake


async def _can_view(user, project) -> bool:
    return await check_action_access(
        user_uid=str(user),
        project_id=str(project),
        permission=Permission.VIEW_APPLICATIONS,
    )


async def test_admin_membership_create_clears_a_cached_denial(cache):
    seeded = await seed_organization(members={"owner": "owner"})
    user = await create_user(label="admin-added")
    seeded.extra_user_ids.append(user)
    project = seeded.project_ids[0]
    try:
        assert await _can_view(user, project) is False
        assert cache.store  # the denial is cached

        service = PlatformAdminAccountsService()
        await service.create_organization_membership(
            dto=AdminSimpleAccountsOrganizationsMembershipsCreate(
                membership=AdminOrganizationMembershipCreate(
                    organization_ref=EntityRef(id=str(seeded.organization_id)),
                    user_ref=EntityRef(id=str(user)),
                    role="editor",
                )
            )
        )
        await service.create_project_membership(
            dto=AdminSimpleAccountsProjectsMembershipsCreate(
                membership=AdminProjectMembershipCreate(
                    project_ref=EntityRef(id=str(project)),
                    user_ref=EntityRef(id=str(user)),
                    role="editor",
                )
            )
        )

        # The admin row carries the role it was given (it was written as viewer).
        rows = await fetch_all(
            "SELECT role FROM organization_members WHERE organization_id = :o AND user_id = :u",
            {"o": seeded.organization_id, "u": user},
        )
        assert [r["role"] for r in rows] == ["editor"]
        assert await _can_view(user, project) is True
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_membership_delete_clears_a_cached_allow(cache):
    if not is_ee():
        pytest.skip("admin membership deletion is EE only")
    seeded = await seed_organization(members={"m": "editor"})
    member, project = seeded.user_ids["m"], seeded.project_ids[0]
    try:
        assert await _can_view(member, project) is True

        rows = await fetch_all(
            "SELECT id FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": project, "u": member},
        )
        await PlatformAdminAccountsService().delete_project_membership(
            project_id=str(project), membership_id=str(rows[0]["id"])
        )

        assert await _can_view(member, project) is False
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_owner_membership_clears_the_former_owner(cache):
    if not is_ee():
        pytest.skip("EE reads the project row role; OSS keeps the organization role")
    seeded = await seed_organization(members={"owner": "owner"})
    owner, project = seeded.owner_id, seeded.project_ids[0]
    successor = await create_user(label="admin-owner")
    seeded.extra_user_ids.append(successor)
    try:
        await fetch_all(
            "UPDATE project_members SET role = 'viewer' "
            "WHERE project_id = :p AND user_id = :u RETURNING id",
            {"p": project, "u": owner},
        )

        async def _can_edit_workspace(user) -> bool:
            return await check_action_access(
                user_uid=str(user),
                project_id=str(project),
                permission=Permission.EDIT_WORKSPACE,
            )

        # The owner shortcut allows, and the answer is cached.
        assert await _can_edit_workspace(owner) is True

        await PlatformAdminAccountsService().create_organization_membership(
            dto=AdminSimpleAccountsOrganizationsMembershipsCreate(
                membership=AdminOrganizationMembershipCreate(
                    organization_ref=EntityRef(id=str(seeded.organization_id)),
                    user_ref=EntityRef(id=str(successor)),
                    role="owner",
                )
            )
        )

        # organizations.owner_id moved: the former owner is now a viewer.
        assert await _can_edit_workspace(owner) is False
    finally:
        await delete_seeded_organization(seeded)
