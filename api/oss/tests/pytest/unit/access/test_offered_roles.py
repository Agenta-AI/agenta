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
from oss.src.core.access.types import RbacEntitlementUnavailable, RoleNotOffered
from oss.tests.pytest.utils.memberships import RecordingRbac

_TRACE_CONTENT = {
    Permission.VIEW_SPANS,
    Permission.VIEW_INVOCATIONS,
    Permission.EDIT_INVOCATIONS,
    Permission.VIEW_ANNOTATIONS,
    Permission.EDIT_ANNOTATIONS,
    *(p for p in Permission if "_evaluation_" in p.value),
}


class _UnreadablePlan:
    """The plan read fails, as the EE adapter raises on a Redis or database error."""

    async def is_entitled(self, *, organization_id):
        raise RbacEntitlementUnavailable()


def _service(*, entitled: bool) -> AccessService:
    return AccessService(
        memberships=None,
        rbac_entitlement=RecordingRbac(entitled=entitled),
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


def test_member_is_developer_without_trace_content_plus_project_setup():
    member = set(get_role_permissions("project", "member"))
    developer = set(get_role_permissions("project", "developer"))
    project_setup = {Permission.CREATE_WORKSPACE.value, Permission.EDIT_WORKSPACE.value}
    assert member == (developer - {p.value for p in _TRACE_CONTENT}) | project_setup
    # Its runs export spans with its credential, and credit balances read under
    # `VIEW_BILLING`.
    assert Permission.EDIT_SPANS.value in member
    assert Permission.VIEW_BILLING.value in member
    assert Permission.RUN_SESSIONS.value in member
    assert Permission.EDIT_BILLING.value not in member
    assert Permission.DELETE_WORKSPACE.value not in member


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


@pytest.mark.parametrize(
    "entitled, role, offered",
    [
        (False, "member", True),
        (False, "admin", True),
        (False, "viewer", False),
        (False, "owner", False),
        (True, "viewer", True),
        (True, "owner", False),
    ],
)
async def test_require_offered_role(entitled, role, offered):
    service = _service(entitled=entitled)
    if offered:
        await service.require_offered_role(organization_id=uuid4(), role=role)
    else:
        with pytest.raises(RoleNotOffered):
            await service.require_offered_role(organization_id=uuid4(), role=role)


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


# -- a plan that cannot be read -----------------------------------------------------------


async def test_an_unreadable_plan_offers_nothing():
    service = AccessService(
        memberships=None,
        rbac_entitlement=_UnreadablePlan(),
        principals=None,
        resource_policy=None,
    )
    with pytest.raises(RbacEntitlementUnavailable):
        await service.offered_roles(organization_id=uuid4())
    with pytest.raises(RbacEntitlementUnavailable):
        await service.require_offered_role(organization_id=uuid4(), role="member")
    # The access decision reads no plan, so it is not affected.
    assert service.role_allows(role="member", action=Permission.RUN_SESSIONS) is True


@pytest.mark.parametrize("roles", [(), ("member",)])
async def test_an_invite_stops_when_the_plan_cannot_be_read(monkeypatch, roles):
    service = AccessService(
        memberships=None,
        rbac_entitlement=_UnreadablePlan(),
        principals=None,
        resource_policy=None,
    )
    monkeypatch.setattr(organization_service, "get_access_service", lambda: service)
    with pytest.raises(HTTPException) as error:
        await organization_service.resolve_workspace_invite_role(
            _invite(*roles), organization_id=str(uuid4())
        )
    assert error.value.status_code == 503


# -- resend -----------------------------------------------------------------------------


@pytest.fixture
def resend(monkeypatch):
    from datetime import datetime, timedelta, timezone

    organization_id = uuid4()
    project = SimpleNamespace(id=uuid4(), organization_id=organization_id)
    state = SimpleNamespace(stored=None, created=[], sent=[], deleted=[])

    def _wire(*, role, expired=False):
        state.stored = SimpleNamespace(
            id=uuid4(),
            email="x@test.agenta.ai",
            role=role,
            used=False,
            token="t",
            project_id=project.id,
            expiration_date=datetime.now(timezone.utc)
            + timedelta(days=-1 if expired else 1),
        )
        return state

    db = organization_service.db_manager

    async def _user(*, user_id):
        return SimpleNamespace(id=user_id, email="admin@test.agenta.ai")

    async def _invitation(*, organization_id, email):
        return state.stored

    async def _project(*, project_id):
        return project

    async def _delete(invitation_id):
        state.deleted.append(invitation_id)
        state.stored = None

    async def _create(role, project_id, email):
        state.created.append(role)
        return SimpleNamespace(token="new")

    async def _send(email, token, **kwargs):
        state.sent.append(token)
        return "https://invite.test/link"

    monkeypatch.setattr(db, "get_user_with_id", _user)
    monkeypatch.setattr(
        db, "get_project_invitation_by_organization_and_email", _invitation
    )
    monkeypatch.setattr(db, "get_project_by_id", _project)
    monkeypatch.setattr(db, "delete_invitation", _delete)
    monkeypatch.setattr(organization_service, "create_invitation", _create)
    monkeypatch.setattr(organization_service, "send_invitation_email", _send)
    return organization_id, project, _wire


async def _resend(organization_id, project):
    return await organization_service.resend_user_organization_invite(
        SimpleNamespace(email="x@test.agenta.ai"),
        project_id=str(project.id),
        user_id=str(uuid4()),
        organization_id=str(organization_id),
    )


@pytest.mark.parametrize("expired", [False, True])
@pytest.mark.parametrize("role", ["viewer", "owner"])
async def test_a_resend_refuses_a_role_the_plan_does_not_offer(
    plan, resend, role, expired
):
    plan(entitled=False)
    organization_id, project, wire = resend
    state = wire(role=role, expired=expired)

    with pytest.raises(HTTPException) as error:
        await _resend(organization_id, project)

    assert error.value.status_code == 400
    assert (state.created, state.sent, state.deleted) == ([], [], [])


@pytest.mark.parametrize("expired", [False, True])
async def test_a_resend_keeps_an_offered_role(plan, resend, expired):
    plan(entitled=False)
    organization_id, project, wire = resend
    state = wire(role="member", expired=expired)

    assert await _resend(organization_id, project) == {
        "url": "https://invite.test/link"
    }
    assert state.created == (["member"] if expired else [])
    assert len(state.sent) == 1


def test_an_owner_invitation_grants_admin():
    assert organization_service.accepted_invitation_role("owner") == "admin"
    assert organization_service.accepted_invitation_role("member") == "member"


@pytest.mark.parametrize("expired", [False, True])
async def test_a_resend_that_cannot_read_the_plan_keeps_the_invitation(
    monkeypatch, resend, expired
):
    organization_id, project, wire = resend
    state = wire(role="member", expired=expired)
    unreadable = AccessService(
        memberships=None,
        rbac_entitlement=_UnreadablePlan(),
        principals=None,
        resource_policy=None,
    )
    monkeypatch.setattr(organization_service, "get_access_service", lambda: unreadable)

    with pytest.raises(HTTPException) as error:
        await _resend(organization_id, project)

    assert error.value.status_code == 503
    assert state.stored is not None
    assert (state.created, state.sent, state.deleted) == ([], [], [])

    # The retry the 503 asks for finds the invitation and goes through.
    readable = _service(entitled=False)
    monkeypatch.setattr(organization_service, "get_access_service", lambda: readable)
    assert await _resend(organization_id, project) == {
        "url": "https://invite.test/link"
    }
    assert len(state.sent) == 1
    assert len(state.deleted) == (1 if expired else 0)
