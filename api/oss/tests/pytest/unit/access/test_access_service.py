"""`AccessService.check_human` over an in-memory membership store.

Ports the non-demo cases of the former `test_project_member_lookup.py`.
"""

from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
from oss.src.core.access.dtos import DecisionReason, RoleRequirement
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.access.types import InvalidRoleRequirement
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import HumanPrincipalsDAO


class _World:
    def __init__(self, *, policy=MembershipPolicy.PROJECT_ROWS, enforced=True):
        self.dao = InMemoryMembershipsDAO()
        self.owner = uuid4()
        self.user = uuid4()
        self.project = self.dao.add_project(
            make_summary(organization_owner_id=self.owner)
        )
        self.rbac = RecordingRbac(enforced=enforced)
        self.service = AccessService(
            memberships=MembershipsService(memberships_dao=self.dao, policy=policy),
            rbac=self.rbac,
            principals=HumanPrincipalsDAO(),
        )

    def member(self, user, *, organization_role="viewer", project_role="__same__"):
        self.dao.add_organization_member(
            organization_id=self.project.organization_id,
            user_id=user,
            role=organization_role,
        )
        if project_role is not None:
            self.dao.add_project_member(
                project_id=self.project.project_id,
                user_id=user,
                role=organization_role if project_role == "__same__" else project_role,
            )

    def member_with_null_role(self, user):
        self.member(user, organization_role="viewer", project_role=None)
        self.dao.add_project_member(
            project_id=self.project.project_id, user_id=user, role=None
        )

    async def check(self, action, *, user=None, project_id=None):
        return await self.service.check_human(
            user_id=user or self.user,
            project_id=project_id or self.project.project_id,
            action=action,
        )


async def test_unknown_project_denies_not_member():
    world = _World()
    decision = await world.check(Permission.VIEW_APPLICATIONS, project_id=uuid4())
    assert (decision.allowed, decision.reason) == (False, DecisionReason.NOT_MEMBER)


async def test_organization_owner_without_membership_denies_not_member():
    world = _World()
    decision = await world.check(Permission.VIEW_APPLICATIONS, user=world.owner)
    assert (decision.allowed, decision.reason) == (False, DecisionReason.NOT_MEMBER)
    assert world.rbac.calls == []


async def test_no_rbac_organization_and_a_non_member_denies_not_member():
    world = _World(enforced=False)
    decision = await world.check(Permission.VIEW_APPLICATIONS)
    assert (decision.allowed, decision.reason) == (False, DecisionReason.NOT_MEMBER)


async def test_no_rbac_member_is_allowed():
    world = _World(enforced=False)
    world.member(world.user, organization_role="viewer")
    decision = await world.check(Permission.DELETE_WORKSPACE)
    assert (decision.allowed, decision.reason) == (
        True,
        DecisionReason.RBAC_NOT_ENTITLED,
    )
    assert world.rbac.calls == [world.project.organization_id]


async def test_organization_owner_member_is_allowed():
    world = _World()
    world.member(world.owner, organization_role="viewer")
    decision = await world.check(Permission.DELETE_WORKSPACE, user=world.owner)
    assert (decision.allowed, decision.reason) == (
        True,
        DecisionReason.ORGANIZATION_OWNER,
    )


async def test_project_owner_passes_any_role_or_permission():
    world = _World()
    world.member(world.user, organization_role="owner")
    for action in (RoleRequirement(role="viewer"), Permission.EDIT_APPLICATIONS):
        decision = await world.check(action)
        assert (decision.allowed, decision.reason) == (
            True,
            DecisionReason.PROJECT_OWNER,
        )


async def test_role_requirement_matches_exactly():
    world = _World()
    world.member(world.user, organization_role="admin")
    decision = await world.check(RoleRequirement(role="admin"))
    assert (decision.allowed, decision.reason) == (True, DecisionReason.ROLE)
    # Exact match, not implication: an admin does not satisfy a viewer check.
    decision = await world.check(RoleRequirement(role="viewer"))
    assert (decision.allowed, decision.reason) == (
        False,
        DecisionReason.MISSING_CAPABILITY,
    )

    editor = _World()
    editor.member(editor.user, organization_role="editor")
    decision = await editor.check(RoleRequirement(role="admin"))
    assert (decision.allowed, decision.reason) == (
        False,
        DecisionReason.MISSING_CAPABILITY,
    )


async def test_permission_uses_the_project_scope_catalog():
    editor = _World()
    editor.member(editor.user, organization_role="editor")
    assert (await editor.check(Permission.EDIT_WORKSPACE)).allowed is False
    assert (await editor.check(Permission.EDIT_APPLICATIONS)).allowed is True

    admin = _World()
    admin.member(admin.user, organization_role="admin")
    assert (await admin.check(Permission.EDIT_WORKSPACE)).allowed is True


async def test_oss_organization_viewer_uses_project_viewer_permissions():
    world = _World(policy=MembershipPolicy.ORGANIZATION_WIDE)
    world.member(world.user, organization_role="viewer", project_role=None)
    assert (await world.check(Permission.VIEW_APPLICATIONS)).allowed is True
    assert (await world.check(Permission.DELETE_WORKSPACE)).allowed is False


async def test_undefined_organization_role_gives_no_permissions_and_logs(monkeypatch):
    events = []

    class _Log:
        def warning(self, event, **fields):
            events.append((event, fields))

        def debug(self, *args, **kwargs):
            pass

        def info(self, *args, **kwargs):  # the "[access] denied" line
            pass

    monkeypatch.setattr(access_module, "log", _Log())
    world = _World(policy=MembershipPolicy.ORGANIZATION_WIDE)
    world.member(world.user, organization_role="workspace_billing", project_role=None)

    decision = await world.check(Permission.VIEW_APPLICATIONS)

    assert (decision.allowed, decision.reason) == (
        False,
        DecisionReason.MISSING_CAPABILITY,
    )
    assert [e for e, _ in events] == ["[access] undefined role slug"]
    assert events[0][1]["role"] == "workspace_billing"


async def test_ee_custom_role_permission_is_allowed(monkeypatch):
    catalog = {"reviewer": ["view_applications"]}
    original_get_role = access_module.get_role
    original_permissions = access_module.get_role_permissions

    def _get_role(scope, slug):
        if slug in catalog:
            return {"role": slug, "permissions": catalog[slug]}
        return original_get_role(scope, slug)

    def _get_role_permissions(scope, slug):
        if slug in catalog:
            return list(catalog[slug])
        return original_permissions(scope, slug)

    monkeypatch.setattr(access_module, "get_role", _get_role)
    monkeypatch.setattr(access_module, "get_role_permissions", _get_role_permissions)
    world = _World()
    world.member(world.user, organization_role="reviewer")

    assert (await world.check(Permission.VIEW_APPLICATIONS)).allowed is True
    assert (await world.check(Permission.EDIT_APPLICATIONS)).allowed is False


async def test_null_role_member_is_denied_ordinary_checks():
    world = _World()
    world.member_with_null_role(world.user)
    for action in (Permission.VIEW_APPLICATIONS, RoleRequirement(role="viewer")):
        decision = await world.check(action)
        assert (decision.allowed, decision.reason) == (
            False,
            DecisionReason.MISSING_CAPABILITY,
        )

    no_rbac = _World(enforced=False)
    no_rbac.member_with_null_role(no_rbac.user)
    decision = await no_rbac.check(Permission.VIEW_APPLICATIONS)
    assert (decision.allowed, decision.reason) == (
        True,
        DecisionReason.RBAC_NOT_ENTITLED,
    )

    owner = _World()
    owner.member_with_null_role(owner.owner)
    decision = await owner.check(Permission.VIEW_APPLICATIONS, user=owner.owner)
    assert (decision.allowed, decision.reason) == (
        True,
        DecisionReason.ORGANIZATION_OWNER,
    )


async def test_unknown_role_raises_invalid_role_specified():
    world = _World()
    world.member(world.user, organization_role="editor")
    with pytest.raises(InvalidRoleRequirement) as error:
        await world.check(RoleRequirement(role="nope"))
    assert error.value.message == "Invalid role specified"


async def test_the_check_reads_one_membership_row():
    world = _World()
    world.member(world.user, organization_role="editor")
    await world.check(Permission.VIEW_APPLICATIONS)
    assert world.dao.reads == ["fetch_membership_row"]
