"""The legacy workspace and organization membership endpoints."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.routers.organization_router as organization_router
import oss.src.services.organization_service as organization_service
from oss.src.core.auth import service as auth_service_module
from oss.src.core.memberships.dtos import OrganizationMember
from oss.src.core.memberships.types import MemberNotFound, OrganizationOwnerProtected
import oss.src.routers.workspace_router as workspace_router
from oss.src.core.access.permissions.types import Permission, RequiredRole


DENIED = (
    "You do not have permission to perform this action. "
    "Please contact your Organization Owner"
)


def _request(user_id=None):
    return SimpleNamespace(state=SimpleNamespace(user_id=str(user_id or uuid4())))


class _Recorder:
    def __init__(self, result=True):
        self.result = result
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


@pytest.fixture
def project():
    return SimpleNamespace(id=uuid4(), organization_id=uuid4(), workspace_id=uuid4())


async def test_remove_user_by_a_non_admin_answers_403(monkeypatch, project):
    access = _Recorder(result=False)
    removed = []

    async def _get_project_by_workspace(workspace_id):
        return project

    monkeypatch.setattr(workspace_router, "check_action_access", access)
    monkeypatch.setattr(
        workspace_router, "get_project_by_workspace", _get_project_by_workspace
    )
    monkeypatch.setattr(workspace_router, "is_ee", lambda: False)

    response = await workspace_router.remove_user_from_workspace(
        email="x@test.agenta.ai",
        workspace_id=str(project.workspace_id),
        request=_request(),
    )

    assert response.status_code == 403
    assert response.body == ('{"detail":"' + DENIED + '"}').encode()
    assert access.calls[0]["role"] == RequiredRole.ADMIN
    assert access.calls[0]["project_id"] == str(project.id)
    assert removed == []


def _wire_update_workspace(monkeypatch, *, project, workspace_organization_id):
    access = _Recorder(result=False)

    async def _get_project_by_workspace(workspace_id):
        return project

    async def _get_workspace(workspace_id):
        return SimpleNamespace(
            id=project.workspace_id, organization_id=workspace_organization_id
        )

    monkeypatch.setattr(organization_router, "check_action_access", access)
    monkeypatch.setattr(
        organization_router.db_manager,
        "get_project_by_workspace",
        _get_project_by_workspace,
    )
    monkeypatch.setattr(organization_router.db_manager, "get_workspace", _get_workspace)
    return access


async def test_update_workspace_checks_edit_workspace(monkeypatch, project):
    access = _wire_update_workspace(
        monkeypatch, project=project, workspace_organization_id=project.organization_id
    )

    response = await organization_router.update_workspace(
        request=_request(),
        organization_id=str(project.organization_id),
        workspace_id=str(project.workspace_id),
        payload=SimpleNamespace(name="x", description=None),
    )

    assert response.status_code == 403
    assert access.calls[0]["permission"] == Permission.EDIT_WORKSPACE
    assert access.calls[0]["project_id"] == str(project.id)


async def test_update_workspace_of_another_organization_is_404(monkeypatch, project):
    # A legacy project of organization A that points at a workspace of organization
    # B: an admin of A must not reach B's workspace through it.
    access = _wire_update_workspace(
        monkeypatch, project=project, workspace_organization_id=uuid4()
    )

    for organization_id in (project.organization_id, uuid4()):
        response = await organization_router.update_workspace(
            request=_request(),
            organization_id=str(organization_id),
            workspace_id=str(project.workspace_id),
            payload=SimpleNamespace(name="x", description=None),
        )
        assert response.status_code == 404

    assert access.calls == []


# -- writers through MembershipsService -----------------------------------------------


class _MembershipsService:
    def __init__(self, *, organization_role=None, raises=None):
        self.organization_role = organization_role
        self.raises = raises
        self.calls = []

    async def set_member_role(self, **kwargs):
        self.calls.append(("set_member_role", kwargs))
        if self.raises:
            raise self.raises

    async def remove_member(self, **kwargs):
        self.calls.append(("remove_member", kwargs))
        if self.raises:
            raise self.raises

    async def fetch_organization_member(self, *, organization_id, user_id):
        if self.organization_role is None:
            return None
        return OrganizationMember(
            organization_id=organization_id,
            user_id=user_id,
            role=self.organization_role,
        )


@pytest.fixture
def wired(monkeypatch, project):
    def _wire(service, *, allowed=True):
        monkeypatch.setattr(memberships_module, "_memberships_service", service)
        monkeypatch.setattr(workspace_router, "check_action_access", _Recorder(allowed))

        async def _get_project_by_workspace(workspace_id):
            return project

        target = SimpleNamespace(id=uuid4(), email="member@test.agenta.ai")

        async def _get_user_with_email(email):
            return target if email == target.email else None

        monkeypatch.setattr(
            workspace_router, "get_project_by_workspace", _get_project_by_workspace
        )
        monkeypatch.setattr(
            workspace_router.db_manager, "get_user_with_email", _get_user_with_email
        )
        monkeypatch.setattr(workspace_router, "is_ee", lambda: False)
        return target

    return _wire


async def test_assign_role_calls_set_member_role_for_the_organization(wired, project):
    service = _MembershipsService()
    target = wired(service)
    caller = uuid4()

    result = await workspace_router.assign_role_to_user(
        payload=SimpleNamespace(
            email=target.email,
            organization_id=str(project.organization_id),
            role="editor",
        ),
        workspace_id=str(project.workspace_id),
        request=_request(caller),
    )

    assert result is True
    assert service.calls == [
        (
            "set_member_role",
            {
                "organization_id": project.organization_id,
                "user_id": target.id,
                "role": "editor",
                "must_exist": True,
                "actor_user_id": caller,
            },
        )
    ]


async def test_assign_role_for_an_unknown_email_is_404(wired, project):
    wired(_MembershipsService())

    with pytest.raises(Exception) as error:
        await workspace_router.assign_role_to_user(
            payload=SimpleNamespace(
                email="nobody@test.agenta.ai",
                organization_id=str(project.organization_id),
                role="editor",
            ),
            workspace_id=str(project.workspace_id),
            request=_request(),
        )

    assert error.value.status_code == 404
    assert error.value.detail == "User not found."


async def test_assign_role_for_a_non_member_is_404(wired, project):
    service = _MembershipsService(raises=MemberNotFound(organization_id=uuid4()))
    target = wired(service)

    with pytest.raises(Exception) as error:
        await workspace_router.assign_role_to_user(
            payload=SimpleNamespace(
                email=target.email,
                organization_id=str(project.organization_id),
                role="editor",
            ),
            workspace_id=str(project.workspace_id),
            request=_request(),
        )

    assert error.value.status_code == 404
    assert error.value.detail == "User not found."


async def test_unassign_current_role_sets_viewer(wired, project):
    service = _MembershipsService(organization_role="editor")
    target = wired(service)

    result = await workspace_router.unassign_role_from_user(
        email=target.email,
        organization_id=str(project.organization_id),
        role="editor",
        workspace_id=str(project.workspace_id),
        request=_request(),
    )

    assert result is True
    assert service.calls[0][1]["role"] == "viewer"
    assert service.calls[0][1]["must_exist"] is True

    other = _MembershipsService(organization_role="admin")
    target = wired(other)
    result = await workspace_router.unassign_role_from_user(
        email=target.email,
        organization_id=str(project.organization_id),
        role="editor",
        workspace_id=str(project.workspace_id),
        request=_request(),
    )
    assert result is True
    assert other.calls == []


async def test_remove_user_calls_remove_member(wired, project):
    service = _MembershipsService()
    wired(service)
    caller = uuid4()

    result = await workspace_router.remove_user_from_workspace(
        email="member@test.agenta.ai",
        workspace_id=str(project.workspace_id),
        request=_request(caller),
    )

    assert result is True
    assert service.calls == [
        (
            "remove_member",
            {
                "organization_id": project.organization_id,
                "email": "member@test.agenta.ai",
                "actor_user_id": caller,
            },
        )
    ]


async def test_owner_protected_errors_keep_todays_body_shape(wired, project):
    protected = OrganizationOwnerProtected(organization_id=uuid4(), user_id=uuid4())

    target = wired(_MembershipsService(raises=protected))
    with pytest.raises(Exception) as error:
        await workspace_router.assign_role_to_user(
            payload=SimpleNamespace(
                email=target.email,
                organization_id=str(project.organization_id),
                role="viewer",
            ),
            workspace_id=str(project.workspace_id),
            request=_request(),
        )
    assert error.value.status_code == 403
    assert error.value.detail == {"message": DENIED}

    wired(_MembershipsService(raises=protected))
    with pytest.raises(Exception) as error:
        await workspace_router.remove_user_from_workspace(
            email="owner@test.agenta.ai",
            workspace_id=str(project.workspace_id),
            request=_request(),
        )
    assert error.value.status_code == 403
    assert error.value.detail == {"message": DENIED}


# -- auto-join --------------------------------------------------------------------------


@pytest.fixture
def auto_join(monkeypatch):
    organization_id = uuid4()

    def _wire(*, already_member: bool):
        service = _MembershipsService()
        monkeypatch.setattr(memberships_module, "_memberships_service", service)
        monkeypatch.setattr(auth_service_module, "is_ee", lambda: True)

        class _Domains:
            async def get_verified_by_slug(self, *, slug):
                return SimpleNamespace(organization_id=organization_id)

        async def _get_user_organizations(user_id):
            return [SimpleNamespace(id=organization_id)] if already_member else []

        monkeypatch.setattr(
            auth_service_module.db_manager,
            "get_user_organizations",
            _get_user_organizations,
        )
        auth = auth_service_module.AuthService.__new__(auth_service_module.AuthService)
        auth.domains_dao = _Domains()

        async def _flags(org_id):
            return {"auto_join": True}

        auth._get_organization_flags = _flags
        return auth, service

    return organization_id, _wire


async def test_auto_join_does_not_change_an_existing_member_role(auto_join):
    _, wire = auto_join
    auth, service = wire(already_member=True)

    await auth.enforce_domain_policies(email="admin@corp.test", user_id=uuid4())

    assert service.calls == []


async def test_auto_join_adds_a_new_user_as_viewer_in_every_project(auto_join):
    organization_id, wire = auto_join
    auth, service = wire(already_member=False)
    user = uuid4()

    await auth.enforce_domain_policies(email="new@corp.test", user_id=user)

    assert service.calls == [
        (
            "set_member_role",
            {
                "organization_id": organization_id,
                "user_id": user,
                "role": "viewer",
                "join_all_projects": True,
                "must_be_absent": True,
                "actor_user_id": user,
            },
        )
    ]


# -- invite accept ----------------------------------------------------------------------


@pytest.fixture
def invitation(monkeypatch):
    from datetime import datetime, timedelta, timezone

    user = SimpleNamespace(id=uuid4(), email="invitee@test.agenta.ai", username="i")
    project = SimpleNamespace(id=uuid4(), organization_id=uuid4(), workspace_id=uuid4())
    invite = SimpleNamespace(
        id=uuid4(),
        email=user.email,
        role="annotator",
        used=False,
        project_id=project.id,
        expiration_date=datetime.now(timezone.utc) + timedelta(days=1),
    )
    updates = []

    async def _user(email):
        return user

    async def _invite(**kwargs):
        return invite

    async def _project(project_id):
        return project

    async def _workspace(workspace_id):
        return SimpleNamespace(id=project.workspace_id)

    async def _update(invitation_id, values_to_update):
        updates.append(values_to_update)

    async def _notify(workspace, user):
        return True

    db = organization_service.db_manager
    monkeypatch.setattr(db, "get_user_with_email", _user)
    monkeypatch.setattr(
        db, "get_project_invitation_by_organization_token_and_email", _invite
    )
    monkeypatch.setattr(db, "get_project_by_id", _project)
    monkeypatch.setattr(db, "get_workspace", _workspace)
    monkeypatch.setattr(db, "update_invitation", _update)
    monkeypatch.setattr(organization_service, "notify_org_admin_invitation", _notify)
    return SimpleNamespace(user=user, project=project, updates=updates)


async def test_invite_accept_writes_through_set_member_role(invitation, monkeypatch):
    service = _MembershipsService(organization_role=None)
    monkeypatch.setattr(memberships_module, "_memberships_service", service)

    assert await organization_service.accept_organization_invitation(
        token="t",
        organization_id=str(invitation.project.organization_id),
        email=invitation.user.email,
        session_email=invitation.user.email,
    )

    assert service.calls == [
        (
            "set_member_role",
            {
                "organization_id": invitation.project.organization_id,
                "user_id": invitation.user.id,
                "role": "annotator",
                "join_all_projects": True,
                "actor_user_id": invitation.user.id,
            },
        )
    ]
    assert invitation.updates == [{"user_id": str(invitation.user.id), "used": True}]


async def test_invite_accept_for_an_existing_member_is_already_accepted(
    invitation, monkeypatch
):
    service = _MembershipsService(organization_role="viewer")
    monkeypatch.setattr(memberships_module, "_memberships_service", service)

    with pytest.raises(organization_service.InviteAlreadyAcceptedError):
        await organization_service.accept_organization_invitation(
            token="t",
            organization_id=str(invitation.project.organization_id),
            email=invitation.user.email,
            session_email=invitation.user.email,
        )

    assert service.calls == []


# -- workspace create and ownership transfer --------------------------------------------


async def test_workspace_create_seeds_its_default_project_through_create_project(
    monkeypatch,
):
    import oss.src.services.db_manager as db_manager_module
    from oss.src.core.memberships.dtos import ProjectScope

    organization = SimpleNamespace(id=uuid4())
    user = SimpleNamespace(id=uuid4())
    project_id = uuid4()
    calls = []

    class _Service:
        async def create_project(self, **kwargs):
            calls.append(kwargs)
            return ProjectScope(
                project_id=project_id,
                organization_id=organization.id,
                workspace_id=kwargs["workspace_id"],
                is_default=True,
            )

    class _Session:
        def add(self, obj):
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()

        async def commit(self):
            pass

        async def refresh(self, obj, attribute_names=None):
            pass

    async def _noop(**kwargs):
        return None

    async def _fetch_project_by_id(project_id):
        return SimpleNamespace(id=project_id)

    monkeypatch.setattr(memberships_module, "_memberships_service", _Service())
    monkeypatch.setattr(db_manager_module, "fetch_project_by_id", _fetch_project_by_id)
    monkeypatch.setattr(db_manager_module, "add_default_simple_testsets", _noop)
    import oss.src.core.environments.defaults as environments_defaults
    import oss.src.core.evaluators.defaults as evaluators_defaults

    monkeypatch.setattr(evaluators_defaults, "create_default_evaluators", _noop)
    monkeypatch.setattr(environments_defaults, "create_default_environments", _noop)

    workspace, project = await db_manager_module.create_workspace_db_object(
        _Session(),
        SimpleNamespace(name="Second", type=None, description=None),
        organization,
        user,
        return_wrk_prj=True,
    )

    assert len(calls) == 1
    assert calls[0]["is_default"] is True
    assert calls[0]["name"] == "Default"
    assert calls[0]["organization_id"] == organization.id
    assert calls[0]["actor_user_id"] == user.id
    assert project.id == str(project_id) or project.id == project_id


async def test_transfer_route_calls_the_service_and_maps_errors(monkeypatch):
    organization_id, new_owner, caller = uuid4(), uuid4(), uuid4()
    calls = []

    class _Service:
        def __init__(self, raises=None):
            self.raises = raises

        async def transfer_ownership(self, **kwargs):
            calls.append(kwargs)
            if self.raises:
                raise self.raises

    async def _is_owner(organization_id, user_id):
        return True

    monkeypatch.setattr(organization_router, "_check_org_owner", _is_owner)

    monkeypatch.setattr(
        memberships_module,
        "_memberships_service",
        _Service(raises=MemberNotFound(organization_id=organization_id)),
    )
    response = await organization_router.transfer_organization_ownership(
        request=_request(caller),
        organization_id=str(organization_id),
        new_owner_id=str(new_owner),
    )
    assert response.status_code == 400
    assert response.body == (
        b'{"detail":"Invalid organization or new owner for ownership transfer"}'
    )

    monkeypatch.setattr(memberships_module, "_memberships_service", _Service())
    response = await organization_router.transfer_organization_ownership(
        request=_request(caller),
        organization_id=str(organization_id),
        new_owner_id=str(new_owner),
    )
    assert response.status_code == 200
    assert response.body == (
        f'{{"organization_id":"{organization_id}","owner_id":"{new_owner}"}}'.encode()
    )
    assert calls[-1] == {
        "organization_id": organization_id,
        "new_owner_id": new_owner,
        "current_owner_id": caller,
    }
