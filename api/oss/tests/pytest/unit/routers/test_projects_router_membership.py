"""The project routes read memberships through the resolver."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.core.memberships.service as memberships_module
import oss.src.routers.projects_router as projects_router
from oss.src.core.access.permissions.types import Permission
from oss.src.core.memberships.dtos import (
    MembershipSource,
    ProjectListing,
    ProjectMembership,
)
from oss.tests.pytest.utils.memberships import make_summary


class _Memberships:
    def __init__(self, *, listings=(), fetched=None):
        self.listings = list(listings)
        self.fetched = fetched
        self.fetch_calls = []

    async def list_for_user(self, *, user_id):
        return self.listings

    async def fetch_for_user(self, *, user_id, project_id):
        self.fetch_calls.append(project_id)
        return self.fetched


def _listing(role="editor"):
    summary = make_summary()
    return ProjectListing(
        membership=ProjectMembership(
            project_id=summary.project_id,
            user_id=uuid4(),
            organization_id=summary.organization_id,
            role=role,
            source=MembershipSource.ORGANIZATION,
        ),
        summary=summary,
    )


def _request(**state):
    return SimpleNamespace(state=SimpleNamespace(user_id=str(uuid4()), **state))


@pytest.fixture
def memberships(monkeypatch):
    def _install(service):
        monkeypatch.setattr(memberships_module, "_memberships_service", service)
        return service

    return _install


async def test_project_list_uses_the_resolved_role(memberships):
    listing = _listing("editor")
    memberships(_Memberships(listings=[listing]))

    response = await projects_router.get_projects(request=_request())

    assert response[0].user_role == "editor"
    assert response[0].project_id == listing.summary.project_id
    assert "is_demo" not in response[0].model_dump()


async def test_project_list_without_memberships_returns_todays_404(memberships):
    memberships(_Memberships(listings=[]))

    response = await projects_router.get_projects(request=_request())

    assert response.status_code == 404
    assert response.body == b'{"message":"No projects found."}'


async def test_project_fetch_current_uses_fetch_for_user(memberships):
    service = memberships(_Memberships(fetched=None))
    project_id = uuid4()

    with pytest.raises(HTTPException) as error:
        await projects_router.get_project(
            project_id="current", request=_request(project_id=str(project_id))
        )

    assert error.value.status_code == 404
    assert error.value.detail == "Project not found"
    assert service.fetch_calls == [project_id]


async def test_project_fetch_returns_the_listing(memberships):
    listing = _listing("viewer")
    memberships(_Memberships(fetched=listing))

    response = await projects_router.get_project(
        project_id=str(listing.summary.project_id), request=_request()
    )

    assert response.user_role == "viewer"
    assert response.organization_name == listing.summary.organization_name


async def test_project_fetch_with_a_malformed_id_is_404(memberships):
    memberships(_Memberships(fetched=None))

    with pytest.raises(HTTPException) as error:
        await projects_router.get_project(project_id="not-a-uuid", request=_request())

    assert error.value.status_code == 404


# -- project route permissions ----------------------------------------------------------


DENIED = (
    "You do not have permission to perform this action. "
    "Please contact your Organization Owner"
)


@pytest.fixture
def routes(monkeypatch):
    state = SimpleNamespace()

    def _wire(*, allowed=True, listing=None, project=None):
        default_project = uuid4()
        state.default_project = default_project
        state.access = AsyncMock(return_value=allowed)
        state.create = AsyncMock()
        state.rename = AsyncMock()
        state.delete = AsyncMock()
        service = _Memberships(fetched=listing)
        service.create_project = state.create
        monkeypatch.setattr(memberships_module, "_memberships_service", service)
        monkeypatch.setattr(projects_router, "check_action_access", state.access)
        monkeypatch.setattr(projects_router, "is_ee", lambda: False)
        monkeypatch.setattr(
            projects_router.db_manager,
            "get_default_project_id_from_workspace",
            AsyncMock(return_value=str(default_project)),
        )
        monkeypatch.setattr(
            projects_router.db_manager, "update_project_name", state.rename
        )
        monkeypatch.setattr(projects_router.db_manager, "delete_project", state.delete)
        monkeypatch.setattr(
            projects_router.db_manager,
            "fetch_project_by_id",
            AsyncMock(return_value=project),
        )
        return state

    return _wire


def _context(**extra):
    return _request(workspace_id=str(uuid4()), organization_id=str(uuid4()), **extra)


async def test_viewer_cannot_create_a_project(routes):
    state = routes(allowed=False)

    with pytest.raises(HTTPException) as error:
        await projects_router.create_project(
            request=_context(), payload=projects_router.CreateProjectRequest(name="New")
        )

    assert (error.value.status_code, error.value.detail) == (403, DENIED)
    assert state.access.await_args.kwargs["permission"] == Permission.CREATE_WORKSPACE
    assert state.access.await_args.kwargs["project_id"] == str(state.default_project)
    state.create.assert_not_awaited()


async def test_create_checks_the_permission_before_the_name_and_the_limit(routes):
    routes(allowed=False)

    with pytest.raises(HTTPException) as error:
        await projects_router.create_project(
            request=_context(), payload=projects_router.CreateProjectRequest(name="  ")
        )

    assert error.value.status_code == 403


async def test_create_without_context_is_400(routes):
    routes()

    with pytest.raises(HTTPException) as error:
        await projects_router.create_project(
            request=_request(), payload=projects_router.CreateProjectRequest(name="New")
        )

    assert (error.value.status_code, error.value.detail) == (
        400,
        "Workspace and organization context are required",
    )


async def test_editor_cannot_rename_a_project(routes):
    state = routes(allowed=False, listing=_listing("editor"))

    with pytest.raises(HTTPException) as error:
        await projects_router.update_project(
            project_id=uuid4(),
            payload=projects_router.UpdateProjectRequest(name="Renamed"),
            request=_request(),
        )

    assert (error.value.status_code, error.value.detail) == (403, DENIED)
    assert state.access.await_args.kwargs["permission"] == Permission.EDIT_WORKSPACE
    state.rename.assert_not_awaited()


async def test_non_member_gets_404_on_update_and_delete(routes):
    organization_id = uuid4()
    state = routes(
        listing=None,
        project=SimpleNamespace(
            id=uuid4(), workspace_id=uuid4(), organization_id=organization_id
        ),
    )

    with pytest.raises(HTTPException) as error:
        await projects_router.update_project(
            project_id=uuid4(),
            payload=projects_router.UpdateProjectRequest(name="Renamed"),
            request=_request(),
        )
    assert (error.value.status_code, error.value.detail) == (404, "Project not found")

    with pytest.raises(HTTPException) as error:
        await projects_router.delete_project(
            project_id=uuid4(), request=_request(organization_id=str(organization_id))
        )
    assert (error.value.status_code, error.value.detail) == (404, "Project not found")
    state.access.assert_not_awaited()


async def test_delete_outside_the_request_workspace_is_404(routes):
    state = routes(
        listing=_listing("owner"),
        project=SimpleNamespace(
            id=uuid4(), workspace_id=uuid4(), organization_id=uuid4()
        ),
    )

    with pytest.raises(HTTPException) as error:
        await projects_router.delete_project(
            project_id=uuid4(), request=_request(organization_id=str(uuid4()))
        )

    assert error.value.status_code == 404
    state.access.assert_not_awaited()


async def test_admin_cannot_delete_a_project(routes):
    organization_id = uuid4()
    state = routes(
        allowed=False,
        listing=_listing("admin"),
        project=SimpleNamespace(
            id=uuid4(), workspace_id=uuid4(), organization_id=organization_id
        ),
    )

    with pytest.raises(HTTPException) as error:
        await projects_router.delete_project(
            project_id=uuid4(), request=_request(organization_id=str(organization_id))
        )

    assert error.value.status_code == 403
    assert state.access.await_args.kwargs["permission"] == Permission.DELETE_WORKSPACE
    state.delete.assert_not_awaited()


async def test_create_in_a_workspace_without_a_default_project_is_400(
    routes, monkeypatch
):
    from sqlalchemy.exc import NoResultFound

    routes()
    monkeypatch.setattr(
        projects_router.db_manager,
        "get_default_project_id_from_workspace",
        AsyncMock(side_effect=NoResultFound("no default")),
    )

    with pytest.raises(HTTPException) as error:
        await projects_router.create_project(
            request=_context(), payload=projects_router.CreateProjectRequest(name="New")
        )

    assert (error.value.status_code, error.value.detail) == (
        400,
        "Workspace and organization context are required",
    )
