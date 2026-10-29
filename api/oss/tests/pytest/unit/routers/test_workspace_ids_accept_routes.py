"""Routes that take or list workspace ids, on data that workspace removal step 2 writes.

An organization without workspace rows answers its own id where a workspace id goes; a
member without a workspace row sees one organization-id item; every other answer stays.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.routers.organization_router as organization_router
import oss.src.routers.workspace_router as workspace_router
import oss.src.services.db_manager as db_manager
from oss.src.models.api.organization_models import OrganizationDetails


def _request(user_id=None):
    return SimpleNamespace(state=SimpleNamespace(user_id=str(user_id or uuid4())))


def _organization():
    now = datetime(2026, 10, 24, tzinfo=timezone.utc)
    return SimpleNamespace(
        id=uuid4(),
        slug=None,
        name="org",
        description="d",
        flags={},
        tags=None,
        meta=None,
        owner_id=uuid4(),
        created_at=now,
        updated_at=now,
    )


async def test_organization_details_endpoint_without_workspaces(monkeypatch):
    organization = _organization()

    async def _none(*args, **kwargs):
        return None

    async def _empty(*args, **kwargs):
        return []

    async def _project(organization_id):
        assert organization_id == str(organization.id)
        return SimpleNamespace(id=uuid4())

    # Step 2: one project read; the members come from that project.
    monkeypatch.setattr(db_manager, "fetch_org_details_project", _project)
    monkeypatch.setattr(db_manager, "_org_details_members", _empty)
    del _none

    details = await db_manager.get_org_details(organization)
    validated = OrganizationDetails(**details)

    assert validated.workspaces == [str(organization.id)]
    assert details["default_workspace"]["id"] == str(organization.id)
    assert details["default_workspace"]["name"] == organization.name
    assert details["default_workspace"]["created_at"] == str(organization.created_at)
    assert details["default_workspace"]["updated_at"] == str(organization.updated_at)


async def test_list_organizations_ee_keeps_empty_workspaces(monkeypatch):
    organization = _organization()

    async def _ids(user_id):
        return {"organization_ids": [str(organization.id)], "workspace_ids": []}

    async def _orgs(ids):
        return [organization]

    monkeypatch.setattr(organization_router, "is_ee", lambda: True)
    monkeypatch.setattr(organization_router, "get_user_org_and_workspace_id", _ids)
    monkeypatch.setattr(db_manager, "get_organizations_by_list_ids", _orgs)

    response = await organization_router.list_organizations(request=_request())

    # Step 2: the organization where the workspace list goes (was []).
    assert [o["workspaces"] for o in response] == [[str(organization.id)]]


async def test_list_organizations_oss_lists_the_organization_id_for_a_member_without_workspace_row(
    monkeypatch,
):
    organization = _organization()

    async def _orgs(user_id):
        return [organization]

    monkeypatch.setattr(organization_router, "is_ee", lambda: False)
    monkeypatch.setattr(db_manager, "get_user_organizations", _orgs)

    response = await organization_router.list_organizations(request=_request())

    assert [o["workspaces"] for o in response] == [[str(organization.id)]]


async def test_get_workspaces_lists_the_organization_id_for_a_member_without_workspace_row(
    monkeypatch,
):
    organization_id = uuid4()

    async def _orgs(user_id):
        organization = _organization()
        organization.id = organization_id
        return [organization]

    monkeypatch.setattr(db_manager, "get_user_organizations", _orgs)

    response = await workspace_router.get_workspace(request=_request())

    assert [(w.id, w.name, w.type) for w in response] == [
        (str(organization_id), "org", "default")
    ]


# --- invitation accept for a project without a workspace --------------------- #


async def test_accept_invitation_for_a_project_without_workspace(monkeypatch):
    from datetime import timedelta

    import oss.src.core.memberships.service as memberships_module
    import oss.src.services.organization_service as organization_service

    user = SimpleNamespace(id=uuid4(), email="invitee@test.agenta.ai", username="i")
    project = SimpleNamespace(id=uuid4(), organization_id=uuid4(), workspace_id=None)
    invite = SimpleNamespace(
        id=uuid4(),
        email=user.email,
        role="viewer",
        used=False,
        project_id=project.id,
        expiration_date=datetime.now(timezone.utc) + timedelta(days=1),
    )
    calls = []

    async def _user(email):
        return user

    async def _invite(**kwargs):
        return invite

    async def _project(project_id):
        return project

    async def _workspace(workspace_id):
        raise AssertionError("no workspace to read")

    async def _notify(**kwargs):
        # Step 2: the organization's admins get the notice for every project.
        calls.append(("notify", kwargs["organization_id"]))
        return True

    async def _update(invitation_id, values_to_update):
        calls.append(("update_invitation", values_to_update))

    class _Memberships:
        async def fetch_organization_member(self, **kwargs):
            return None

        async def set_member_role(self, **kwargs):
            calls.append(("set_member_role", kwargs["role"]))

    db = organization_service.db_manager
    monkeypatch.setattr(db, "get_user_with_email", _user)
    monkeypatch.setattr(
        db, "get_project_invitation_by_organization_token_and_email", _invite
    )
    monkeypatch.setattr(db, "get_project_by_id", _project)

    async def _scoped(*, project_id):
        return db.ProjectWithWorkspaceOrganization(
            project=project, workspace_organization_id=None
        )

    monkeypatch.setattr(db, "fetch_project_with_workspace_organization", _scoped)
    monkeypatch.setattr(db, "get_workspace", _workspace)
    monkeypatch.setattr(db, "update_invitation", _update)
    monkeypatch.setattr(organization_service, "notify_org_admin_invitation", _notify)
    monkeypatch.setattr(memberships_module, "_memberships_service", _Memberships())

    assert await organization_service.accept_organization_invitation(
        token="t",
        organization_id=str(project.organization_id),
        email=user.email,
        session_email=user.email,
    )
    assert calls == [
        ("set_member_role", "viewer"),
        ("update_invitation", {"user_id": str(user.id), "used": True}),
        ("notify", project.organization_id),
    ]


# --- read_membership: the resolver read without its cache --------------------- #


async def test_read_membership_reads_once_and_never_touches_the_cache(monkeypatch):
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService
    import oss.src.core.memberships.service as memberships_module
    from oss.tests.pytest.utils.memberships import (
        InMemoryMembershipsDAO,
        make_summary,
    )

    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )
    reads = []
    original = dao.fetch_membership_row

    async def _counted(**kwargs):
        reads.append(kwargs)
        return await original(**kwargs)

    async def _no_cache(*args, **kwargs):
        raise AssertionError("read_membership must not use the cache")

    monkeypatch.setattr(dao, "fetch_membership_row", _counted)
    monkeypatch.setattr(memberships_module, "get_cache", _no_cache)
    monkeypatch.setattr(memberships_module, "set_cache", _no_cache)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )

    membership = await service.read_membership(
        user_id=user, project_id=project.project_id
    )

    assert membership.role == "editor"
    assert len(reads) == 1
    assert (
        await service.read_membership(user_id=uuid4(), project_id=project.project_id)
        is None
    )


# --- B3: delete context, /access scope, invitation accept scope --------------- #


async def test_delete_project_accepts_the_organization_context(monkeypatch):
    import oss.src.routers.projects_router as projects_router

    organization_id, project_id = uuid4(), uuid4()
    listings = []

    async def _project(project_id):
        return SimpleNamespace(
            id=project_id, workspace_id=None, organization_id=organization_id
        )

    async def _listing(request, project_id):
        listings.append(project_id)
        return None

    monkeypatch.setattr(db_manager, "fetch_project_by_id", _project)
    monkeypatch.setattr(projects_router, "_fetch_listing", _listing)
    request = SimpleNamespace(
        state=SimpleNamespace(organization_id=str(organization_id))
    )

    with pytest.raises(HTTPException) as error:
        await projects_router.delete_project(project_id=project_id, request=request)

    assert error.value.status_code == 404
    assert listings == [project_id]  # passed the context check


async def test_delete_project_refuses_another_organization(monkeypatch):
    import oss.src.routers.projects_router as projects_router

    listings = []

    async def _project(project_id):
        return SimpleNamespace(
            id=project_id, workspace_id=uuid4(), organization_id=uuid4()
        )

    async def _listing(request, project_id):
        listings.append(project_id)
        return None

    monkeypatch.setattr(db_manager, "fetch_project_by_id", _project)
    monkeypatch.setattr(projects_router, "_fetch_listing", _listing)
    request = SimpleNamespace(state=SimpleNamespace(organization_id=str(uuid4())))

    with pytest.raises(HTTPException) as error:
        await projects_router.delete_project(project_id=uuid4(), request=request)

    assert error.value.status_code == 404
    assert listings == []


async def test_access_scope_workspace_accepts_the_organization_id(monkeypatch):
    import oss.src.apis.fastapi.access.router as access_router

    scope = SimpleNamespace(
        workspace_id=uuid4(), organization_id=uuid4(), project_id=uuid4()
    )
    monkeypatch.setattr(access_router, "get_auth_scope", lambda: scope)

    assert await access_router._check_scope_access(
        scope_type="workspace", scope_id=scope.organization_id
    )
    # Step 2: a legacy workspace id is refused (no client sends it; it grants nothing).
    assert not await access_router._check_scope_access(
        scope_type="workspace", scope_id=scope.workspace_id
    )


async def test_access_scope_workspace_refuses_another_id(monkeypatch):
    import oss.src.apis.fastapi.access.router as access_router

    scope = SimpleNamespace(
        workspace_id=uuid4(), organization_id=uuid4(), project_id=uuid4()
    )
    monkeypatch.setattr(access_router, "get_auth_scope", lambda: scope)

    assert not await access_router._check_scope_access(
        scope_type="workspace", scope_id=uuid4()
    )


@pytest.fixture
def invitation(monkeypatch):
    from datetime import timedelta

    import oss.src.core.memberships.service as memberships_module
    import oss.src.services.organization_service as organization_service

    organization_id, workspace_id = uuid4(), uuid4()
    user = SimpleNamespace(id=uuid4(), email="invitee@test.agenta.ai", username="i")
    project = SimpleNamespace(
        id=uuid4(), organization_id=organization_id, workspace_id=workspace_id
    )
    invite = SimpleNamespace(
        id=uuid4(),
        email=user.email,
        role="viewer",
        used=False,
        project_id=project.id,
        expiration_date=datetime.now(timezone.utc) + timedelta(days=1),
    )
    world = SimpleNamespace(
        user=user,
        project=project,
        workspace_organization_id=organization_id,
        workspaces={},
        reads=[],
        writes=[],
        notified=[],
        service=organization_service,
    )

    async def _user(email):
        return user

    async def _invite(**kwargs):
        return invite

    async def _scoped(*, project_id):
        world.reads.append("fetch_project_with_workspace_organization")
        return db_manager.ProjectWithWorkspaceOrganization(
            project=project, workspace_organization_id=world.workspace_organization_id
        )

    async def _project(project_id):
        world.reads.append("get_project_by_id")
        return project

    async def _workspace(workspace_id):
        world.reads.append("get_workspace")
        return world.workspaces.get(str(workspace_id))

    async def _update(invitation_id, values_to_update):
        world.writes.append("update_invitation")

    async def _notify(**kwargs):
        world.notified.append(kwargs)
        return True

    class _Memberships:
        async def fetch_organization_member(self, **kwargs):
            return None

        async def set_member_role(self, **kwargs):
            world.writes.append("set_member_role")

    db = organization_service.db_manager
    monkeypatch.setattr(db, "get_user_with_email", _user)
    monkeypatch.setattr(
        db, "get_project_invitation_by_organization_token_and_email", _invite
    )
    monkeypatch.setattr(db, "fetch_project_with_workspace_organization", _scoped)
    monkeypatch.setattr(db, "get_project_by_id", _project)
    monkeypatch.setattr(db, "get_workspace", _workspace)
    monkeypatch.setattr(db, "update_invitation", _update)
    monkeypatch.setattr(organization_service, "notify_org_admin_invitation", _notify)
    monkeypatch.setattr(memberships_module, "_memberships_service", _Memberships())
    return world


async def _accept(world, workspace_id):
    return await world.service.accept_organization_invitation(
        token="t",
        organization_id=str(world.project.organization_id),
        workspace_id=str(workspace_id),
        email=world.user.email,
        session_email=world.user.email,
    )


async def test_accept_invitation_with_the_organization_id(invitation):
    assert await _accept(invitation, invitation.project.organization_id)
    assert invitation.writes == ["set_member_role", "update_invitation"]


async def test_accept_invitation_with_the_project_workspace(invitation):
    assert await _accept(invitation, invitation.project.workspace_id)
    # Step 2: the admin notice reads no workspace.
    assert invitation.reads.count("get_workspace") == 0


async def test_accept_invitation_with_another_workspace_of_the_organization(invitation):
    other = uuid4()
    invitation.workspaces[str(other)] = SimpleNamespace(
        id=other, organization_id=invitation.project.organization_id
    )
    assert await _accept(invitation, other)
    assert invitation.reads.count("get_workspace") == 1  # the scope check


async def test_accept_invitation_refuses_another_organization_id(invitation):
    with pytest.raises(invitation.service.InviteNotFoundError):
        await _accept(invitation, uuid4())
    assert invitation.writes == []


async def test_accept_invitation_refuses_a_workspace_of_another_organization(
    invitation,
):
    other = uuid4()
    invitation.workspaces[str(other)] = SimpleNamespace(
        id=other, organization_id=uuid4()
    )
    with pytest.raises(invitation.service.InviteNotFoundError):
        await _accept(invitation, other)
    assert invitation.writes == []


async def test_accept_invitation_refuses_the_cross_organization_workspace(invitation):
    # P of O1 sits in workspace W of O2: /organizations/O1/workspaces/W/invite/accept.
    foreign = uuid4()
    invitation.workspace_organization_id = foreign
    invitation.workspaces[str(invitation.project.workspace_id)] = SimpleNamespace(
        id=invitation.project.workspace_id, organization_id=foreign
    )
    with pytest.raises(invitation.service.InviteNotFoundError):
        await _accept(invitation, invitation.project.workspace_id)
    assert invitation.writes == []


async def test_accept_invitation_adds_no_project_read(invitation):
    # Today the accept reads the project twice; the scope check rides on the first read.
    await _accept(invitation, invitation.project.organization_id)
    assert invitation.reads.count("fetch_project_with_workspace_organization") == 1
    assert invitation.reads.count("get_project_by_id") == 1
    assert invitation.reads.count("get_workspace") == 0  # step 2: no workspace read


async def test_accept_invitation_without_workspace_through_the_organization_id(
    invitation,
):
    invitation.project.workspace_id = None
    invitation.workspace_organization_id = None
    assert await _accept(invitation, invitation.project.organization_id)
    assert invitation.writes == ["set_member_role", "update_invitation"]
    assert "get_workspace" not in invitation.reads
    # Step 2: the admin notice goes out for a project without a workspace too.
    assert invitation.notified == [
        {
            "organization_id": invitation.project.organization_id,
            "project_id": invitation.project.id,
            "user": invitation.user,
        }
    ]
