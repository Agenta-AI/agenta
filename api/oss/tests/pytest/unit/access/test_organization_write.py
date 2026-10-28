"""`check_organization_write`: organization-level writes by an API key must come from
the organization's default project, as the workspace routes require. A browser session
is not confined."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.access.permissions.service as permissions_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.permissions.service import check_organization_write
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)


class _World:
    def __init__(self, monkeypatch, *, has_default=True):
        self.dao = InMemoryMembershipsDAO()
        self.principals = InMemoryPrincipalsDAO()
        self.organization_id = uuid4()
        self.owner = uuid4()
        self.default = self.dao.add_project(
            make_summary(
                organization_id=self.organization_id,
                organization_owner_id=self.owner,
                is_default=True,
            )
        )
        self.other = self.dao.add_project(
            make_summary(
                organization_id=self.organization_id,
                organization_owner_id=self.owner,
            )
        )
        for project in (self.default, self.other):
            self.dao.add_organization_member(
                organization_id=self.organization_id, user_id=self.owner, role="owner"
            )
            self.dao.add_project_member(
                project_id=project.project_id, user_id=self.owner, role="owner"
            )
        service = AccessService(
            memberships=MembershipsService(
                memberships_dao=self.dao, policy=MembershipPolicy.PROJECT_ROWS
            ),
            rbac=RecordingRbac(enforced=True),
            principals=self.principals,
            resource_policy=AllowAllResourcePolicy(),
        )
        default = (
            SimpleNamespace(project_id=self.default.project_id) if has_default else None
        )

        async def _default_project(*, workspace_or_organization_id):
            assert workspace_or_organization_id == str(self.organization_id)
            return default

        monkeypatch.setattr(permissions_module, "get_access_service", lambda: service)
        monkeypatch.setattr(
            permissions_module.db_manager,
            "fetch_default_project",
            _default_project,
        )

    def key_access(self, project):
        key = self.principals.api_key(
            project_id=project.project_id, created_by_id=self.owner
        )
        return make_request_access(
            envelope=make_envelope(
                kind="api_key",
                principal_id=key.id,
                project_id=project.project_id,
                organization_id=self.organization_id,
            ),
            credential_kind="api_key",
            acting_user_id=self.owner,
        )

    def session_access(self, project):
        human = self.principals.human(self.owner)
        return make_request_access(
            envelope=make_envelope(
                principal_id=human.id,
                project_id=project.project_id,
                organization_id=self.organization_id,
            ),
            credential_kind="bearer_session",
        )


async def _check(world, access):
    token = set_request_access(access)
    try:
        return await check_organization_write(
            user_uid=str(world.owner),
            organization_id=str(world.organization_id),
            permission=Permission.EDIT_ORGANIZATION,
        )
    finally:
        reset_request_access(token)


async def test_a_key_of_the_default_project_may_write(monkeypatch):
    world = _World(monkeypatch)
    assert await _check(world, world.key_access(world.default)) is True


async def test_a_key_of_another_project_is_refused(monkeypatch):
    world = _World(monkeypatch)
    assert await _check(world, world.key_access(world.other)) is False


@pytest.mark.parametrize("project", ["default", "other"])
async def test_a_browser_session_is_not_confined(monkeypatch, project):
    world = _World(monkeypatch)
    access = world.session_access(getattr(world, project))
    assert await _check(world, access) is True


async def test_a_key_is_refused_without_a_default_project(monkeypatch):
    world = _World(monkeypatch, has_default=False)
    assert await _check(world, world.key_access(world.default)) is False
