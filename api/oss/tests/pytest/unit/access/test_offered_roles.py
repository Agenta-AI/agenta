"""Small team roles: the `member` role, the roles each plan offers, and the invite rule.

Roles apply on every plan. The plan decides only which roles an invite or a role change
may set (`AccessService.offered_roles`): with the RBAC entitlement (Business, Enterprise)
every catalog role but `owner`, floor role `viewer`; without it (OSS, Hobby, Pro) `admin`
and `member`, floor role `member`.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.routers.workspace_router as workspace_router
import oss.src.services.organization_service as organization_service
from oss.src.core.access.controls import get_role, get_role_permissions
from oss.src.core.access.permissions.types import DefaultRole, Permission
from oss.src.core.access.service import AccessService
from oss.tests.pytest.utils.memberships import RecordingRbac

_TRACE_CONTENT = {
    Permission.VIEW_SPANS,
    Permission.VIEW_INVOCATIONS,
    Permission.EDIT_INVOCATIONS,
    Permission.VIEW_ANNOTATIONS,
    Permission.EDIT_ANNOTATIONS,
    *(p for p in Permission if "_evaluation_" in p.value),
}


def _service(*, entitled: bool) -> AccessService:
    return AccessService(
        memberships=None,
        rbac=RecordingRbac(entitled=entitled),
        principals=None,
        resource_policy=None,
    )


# -- the catalog ------------------------------------------------------------------------


@pytest.mark.parametrize("scope", ["organization", "workspace", "project"])
def test_member_is_in_every_scope(scope):
    entry = get_role(scope, "member")
    assert entry is not None
    if scope == "organization":
        assert entry["permissions"] == []


def test_member_is_developer_without_trace_content():
    member = set(get_role_permissions("project", "member"))
    developer = set(get_role_permissions("project", "developer"))
    assert member == developer - {p.value for p in _TRACE_CONTENT}
    # Its runs export spans with its credential, and credit balances read under
    # `VIEW_BILLING`.
    assert Permission.EDIT_SPANS.value in member
    assert Permission.VIEW_BILLING.value in member
    assert Permission.RUN_SESSIONS.value in member
    assert Permission.EDIT_BILLING.value not in member


def test_admin_gains_edit_billing_and_keeps_traces():
    admin = set(get_role_permissions("project", "admin"))
    assert Permission.EDIT_BILLING.value in admin
    assert Permission.VIEW_SPANS.value in admin
    assert Permission.DELETE_WORKSPACE.value not in admin


@pytest.mark.parametrize("role", ["developer", "editor", "annotator", "viewer"])
def test_other_roles_keep_trace_reads_and_gain_no_billing(role):
    permissions = set(get_role_permissions("project", role))
    assert Permission.VIEW_SPANS.value in permissions
    assert Permission.EDIT_BILLING.value not in permissions


def test_member_and_admin_have_descriptions():
    assert "traces" in DefaultRole.get_description(DefaultRole.MEMBER)
    assert "billing" in DefaultRole.get_description(DefaultRole.ADMIN)


# -- offered roles ----------------------------------------------------------------------


async def test_without_rbac_admin_and_member_are_offered():
    offered = await _service(entitled=False).offered_roles(organization_id=uuid4())
    assert offered.roles == ["admin", "member"]
    assert offered.floor_role == "member"


async def test_with_rbac_every_role_but_owner_is_offered():
    offered = await _service(entitled=True).offered_roles(organization_id=uuid4())
    assert "owner" not in offered.roles
    assert set(offered.roles) == {
        "admin",
        "member",
        "developer",
        "editor",
        "annotator",
        "viewer",
    }
    assert offered.floor_role == "viewer"


async def test_the_decision_does_not_read_the_plan():
    service = _service(entitled=False)
    assert service.role_allows(role="viewer", action=Permission.VIEW_SPANS) is True
    assert service.role_allows(role="member", action=Permission.VIEW_SPANS) is False
    assert service._rbac.calls == []


# -- invite -----------------------------------------------------------------------------


@pytest.fixture
def plan(monkeypatch):
    def _plan(*, entitled):
        service = _service(entitled=entitled)
        monkeypatch.setattr(organization_service, "get_access_service", lambda: service)
        monkeypatch.setattr(workspace_router, "get_access_service", lambda: service)
        return service

    return _plan


def _invite(*roles):
    return SimpleNamespace(email="x@test.agenta.ai", roles=list(roles) or None)


@pytest.mark.parametrize("entitled, floor_role", [(False, "member"), (True, "viewer")])
async def test_an_invite_without_a_role_gets_the_floor_role(plan, entitled, floor_role):
    plan(entitled=entitled)
    role = await organization_service.resolve_workspace_invite_role(
        _invite(), organization_id=str(uuid4())
    )
    assert role == floor_role


@pytest.mark.parametrize("entitled", [True, False])
async def test_an_invite_never_names_owner(plan, entitled):
    plan(entitled=entitled)
    with pytest.raises(HTTPException) as error:
        await organization_service.resolve_workspace_invite_role(
            _invite("owner"), organization_id=str(uuid4())
        )
    assert error.value.status_code == 400


@pytest.mark.parametrize("role", ["viewer", "developer", "editor", "annotator"])
async def test_without_rbac_an_invite_refuses_other_roles(plan, role):
    plan(entitled=False)
    with pytest.raises(HTTPException) as error:
        await organization_service.resolve_workspace_invite_role(
            _invite(role), organization_id=str(uuid4())
        )
    assert error.value.status_code == 400


async def test_with_rbac_an_invite_accepts_viewer(plan):
    plan(entitled=True)
    role = await organization_service.resolve_workspace_invite_role(
        _invite("viewer"), organization_id=str(uuid4())
    )
    assert role == "viewer"


async def test_an_unknown_role_is_invalid(plan):
    plan(entitled=True)
    with pytest.raises(HTTPException) as error:
        await organization_service.resolve_workspace_invite_role(
            _invite("reviewer"), organization_id=str(uuid4())
        )
    assert "invalid" in error.value.detail


# -- GET /workspaces/roles/ -------------------------------------------------------------


@pytest.mark.parametrize(
    "entitled, expected",
    [
        (False, ["admin", "member"]),
        (True, ["admin", "member", "viewer", "developer", "editor", "annotator"]),
    ],
)
async def test_workspace_roles_lists_the_offered_roles(
    plan, monkeypatch, entitled, expected
):
    plan(entitled=entitled)
    monkeypatch.setattr(
        workspace_router,
        "get_auth_scope",
        lambda: SimpleNamespace(organization_id=uuid4()),
    )
    roles = await workspace_router.get_all_workspace_roles(request=None)
    assert sorted(entry["role_name"] for entry in roles) == sorted(expected)
    assert all(entry["role_description"] for entry in roles)
