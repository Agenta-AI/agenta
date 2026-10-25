"""Workspace removal step 2: the routes answer and check the organization where a
workspace was."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.services.db_manager as db_manager


async def test_access_scope_workspace_is_the_organization(monkeypatch):
    import oss.src.apis.fastapi.access.router as access_router

    organization_id, legacy_workspace_id = uuid4(), uuid4()
    scope = SimpleNamespace(organization_id=organization_id, project_id=uuid4())
    monkeypatch.setattr(access_router, "get_auth_scope", lambda: scope)

    assert await access_router._check_scope_access(
        scope_type="workspace", scope_id=organization_id
    )
    assert not await access_router._check_scope_access(
        scope_type="workspace", scope_id=legacy_workspace_id
    )


async def test_delete_project_compares_the_organization(monkeypatch):
    import oss.src.routers.projects_router as projects_router

    organization_id, workspace_id = uuid4(), uuid4()
    passed = []

    async def _project(project_id):
        return SimpleNamespace(
            id=project_id, workspace_id=workspace_id, organization_id=organization_id
        )

    async def _listing(request, project_id):
        passed.append(project_id)
        return None

    monkeypatch.setattr(db_manager, "fetch_project_by_id", _project)
    monkeypatch.setattr(projects_router, "_fetch_listing", _listing)

    # The project's legacy workspace id as the context no longer passes: the context
    # is the organization.
    for state, expected in (
        (SimpleNamespace(organization_id=str(organization_id)), 1),
        (SimpleNamespace(organization_id=str(uuid4())), 0),
    ):
        passed.clear()
        with pytest.raises(HTTPException) as error:
            await projects_router.delete_project(
                project_id=uuid4(), request=SimpleNamespace(state=state)
            )
        assert error.value.status_code == 404
        assert len(passed) == expected


def test_audit_attributes_have_no_workspace():
    from oss.src.core.gateways.policy import audit

    import inspect

    assert "workspace_id" not in inspect.getsource(audit.build_gateway_call_attributes)


_GONE = "Workspaces were removed. Projects belong to the organization."


async def test_workspace_create_returns_410(monkeypatch):
    import oss.src.routers.organization_router as organization_router

    async def _no_call(*args, **kwargs):
        raise AssertionError("no read and no write")

    for name in ("get_workspace", "get_project_by_workspace", "get_organization"):
        monkeypatch.setattr(db_manager, name, _no_call)
    monkeypatch.setattr(organization_router, "_check_org_owner", _no_call)

    with pytest.raises(HTTPException) as error:
        await organization_router.create_workspace(
            request=SimpleNamespace(state=SimpleNamespace(user_id=str(uuid4()))),
            organization_id=str(uuid4()),
            payload=organization_router.CreateWorkspace(name="w"),
        )
    assert (error.value.status_code, error.value.detail) == (410, _GONE)


async def test_workspace_rename_returns_410_and_keeps_the_name(monkeypatch):
    import oss.src.routers.organization_router as organization_router

    async def _no_call(*args, **kwargs):
        raise AssertionError("no read and no write")

    for name in ("get_workspace", "get_project_by_workspace"):
        monkeypatch.setattr(db_manager, name, _no_call)

    with pytest.raises(HTTPException) as error:
        await organization_router.update_workspace(
            request=SimpleNamespace(state=SimpleNamespace(user_id=str(uuid4()))),
            organization_id=str(uuid4()),
            workspace_id=str(uuid4()),
            payload=organization_router.UpdateWorkspace(name="renamed"),
        )
    assert (error.value.status_code, error.value.detail) == (410, _GONE)


async def test_create_project_passes_no_workspace(monkeypatch):
    import oss.src.core.memberships.service as memberships_module
    import oss.src.routers.projects_router as projects_router
    from oss.src.core.memberships.dtos import ProjectScope

    organization_id, default_project, user = uuid4(), uuid4(), uuid4()
    calls = []

    class _Service:
        async def create_project(self, **kwargs):
            calls.append(kwargs)
            return ProjectScope(
                project_id=uuid4(),
                organization_id=organization_id,
                workspace_id=organization_id,
                is_default=False,
            )

    async def _default(workspace_id):
        assert workspace_id == str(organization_id)
        return str(default_project)

    async def _allow(*args, **kwargs):
        return None

    async def _none(*args, **kwargs):
        return None

    monkeypatch.setattr(memberships_module, "_memberships_service", _Service())
    monkeypatch.setattr(projects_router, "get_memberships_service", lambda: _Service())
    monkeypatch.setattr(db_manager, "get_default_project_id_from_workspace", _default)
    monkeypatch.setattr(projects_router, "_require", _allow)
    monkeypatch.setattr(projects_router, "is_ee", lambda: False)
    monkeypatch.setattr(projects_router, "_fetch_listing", _none)
    import oss.src.core.evaluators.defaults as evaluator_defaults
    import oss.src.core.environments.defaults as environment_defaults

    monkeypatch.setattr(evaluator_defaults, "create_default_evaluators", _none)
    monkeypatch.setattr(environment_defaults, "create_default_environments", _none)

    request = SimpleNamespace(
        state=SimpleNamespace(
            organization_id=str(organization_id),
            workspace_id=str(organization_id),
            user_id=str(user),
        )
    )
    with pytest.raises(HTTPException):  # the stubbed listing answers 404 afterwards
        await projects_router.create_project(
            request=request,
            payload=projects_router.CreateProjectRequest(name="p"),
        )
    assert calls and "workspace_id" not in calls[0]
    assert calls[0]["organization_id"] == organization_id


def _organization(organization_id):
    return SimpleNamespace(
        id=organization_id,
        slug=None,
        name="Org",
        description="d",
        flags={},
        tags=None,
        meta=None,
        owner_id=uuid4(),
    )


@pytest.mark.parametrize("edition", ["oss", "ee"])
async def test_organizations_list_answers_the_organization_in_both_editions(
    monkeypatch, edition
):
    import oss.src.routers.organization_router as organization_router

    organization_id = uuid4()
    reads = []

    async def _user_orgs(user_id):
        reads.append("get_user_organizations")
        return [_organization(organization_id)]

    async def _ids(user_id):
        reads.append("get_user_org_and_workspace_id")
        return {"organization_ids": [str(organization_id)]}

    async def _by_ids(ids):
        reads.append("get_organizations_by_list_ids")
        return [_organization(organization_id)]

    monkeypatch.setattr(organization_router, "is_ee", lambda: edition == "ee")
    monkeypatch.setattr(db_manager, "get_user_organizations", _user_orgs)
    monkeypatch.setattr(db_manager, "get_organizations_by_list_ids", _by_ids)
    monkeypatch.setattr(organization_router, "get_user_org_and_workspace_id", _ids)
    response = await organization_router.list_organizations(
        request=SimpleNamespace(state=SimpleNamespace(user_id=str(uuid4())))
    )
    assert response[0]["workspaces"] == [str(organization_id)]
    # OSS: one read fewer than step 1 (no workspace item read).
    assert reads == (
        ["get_user_organizations"]
        if edition == "oss"
        else ["get_user_org_and_workspace_id", "get_organizations_by_list_ids"]
    )


async def test_workspaces_list_has_one_item_per_organization(monkeypatch):
    import oss.src.routers.workspace_router as workspace_router

    first, second = uuid4(), uuid4()

    async def _user_orgs(user_id):
        # Two membership rows in the first organization: still one item.
        return [_organization(first), _organization(first), _organization(second)]

    monkeypatch.setattr(db_manager, "get_user_organizations", _user_orgs)
    items = await workspace_router.get_workspace(
        request=SimpleNamespace(state=SimpleNamespace(user_id=str(uuid4())))
    )
    assert [(i.id, i.name, i.type) for i in items] == [
        (str(first), "Org", "default"),
        (str(second), "Org", "default"),
    ]


async def test_invite_link_carries_the_organization_id(monkeypatch):
    from oss.src.services import organization_service

    sent = []

    async def _send(email, token, *, project_id, workspace_id, organization_id, user):
        sent.append((workspace_id, organization_id))
        return True

    organization_id, workspace_id, project_id = uuid4(), uuid4(), uuid4()
    project = SimpleNamespace(
        id=project_id, workspace_id=workspace_id, organization_id=organization_id
    )

    async def _project(project_id):
        return project

    async def _none(*args, **kwargs):
        return None

    async def _invitation(*args, **kwargs):
        return SimpleNamespace(token="t")

    monkeypatch.setattr(organization_service, "send_invitation_email", _send)
    monkeypatch.setattr(db_manager, "get_project_by_id", _project)
    monkeypatch.setattr(organization_service, "check_existing_invitation", _none)
    monkeypatch.setattr(
        organization_service, "check_existing_organization_invitation", _none
    )
    monkeypatch.setattr(organization_service, "create_invitation", _invitation)
    import inspect

    source = inspect.getsource(organization_service.invite_user_to_organization)
    assert "workspace_id=str(project_db.organization_id)" in source
    source = inspect.getsource(organization_service.resend_user_organization_invite)
    assert "workspace_id=str(project_db.organization_id)" in source
