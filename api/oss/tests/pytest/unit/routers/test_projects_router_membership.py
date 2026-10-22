"""The project routes read memberships through the resolver."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.core.memberships.service as memberships_module
import oss.src.routers.projects_router as projects_router
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
