"""The Bearer `?project_id=` membership check goes through the membership resolver."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import oss.src.core.memberships.service as memberships_module
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.middlewares import auth
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/projects/",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture
def world(monkeypatch):
    user = uuid4()
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )
    monkeypatch.setattr(memberships_module, "_memberships_service", service)

    sets = []

    async def _get_session(request):
        return SimpleNamespace(get_user_id=lambda: "supertokens-user")

    async def _get_cache(*, namespace, **kwargs):
        if namespace == "get_supertokens_user_by_id":
            return {"user_id": str(user), "user_email": "member@test.agenta.ai"}
        return None

    async def _set_cache(**kwargs):
        sets.append(kwargs)

    async def _get_project_by_id(project_id):
        return SimpleNamespace(
            id=project.project_id,
            workspace_id=project.workspace_id,
            organization_id=project.organization_id,
        )

    async def _get_workspace(workspace_id):
        return SimpleNamespace(
            id=project.workspace_id, organization_id=project.organization_id
        )

    async def _get_default_project_id_from_workspace(workspace_id):
        return str(project.project_id)

    monkeypatch.setattr(auth, "get_session", _get_session)
    monkeypatch.setattr(auth, "get_cache", _get_cache)
    monkeypatch.setattr(auth, "set_cache", _set_cache)
    monkeypatch.setattr(auth.db_manager, "get_project_by_id", _get_project_by_id)
    monkeypatch.setattr(auth.db_manager, "get_workspace", _get_workspace)
    monkeypatch.setattr(
        auth.db_manager,
        "get_default_project_id_from_workspace",
        _get_default_project_id_from_workspace,
    )

    return SimpleNamespace(
        user=user,
        dao=dao,
        service=service,
        project=project,
        sets=sets,
    )


async def test_bearer_non_member_is_refused(world):
    with pytest.raises(HTTPException) as error:
        await auth.verify_bearer_token(
            request=_request(),
            bearer_token="token",
            query_project_id=str(world.project.project_id),
        )

    assert error.value.status_code == 401
    assert error.value.detail == "Unauthorized"
    assert world.dao.reads == ["fetch_membership_row"]
    assert not [s for s in world.sets if s.get("value") == {"deny": True}]


async def test_bearer_workspace_branch_checks_project_membership(world, monkeypatch):
    read_calls = []

    async def _read_membership(**kwargs):
        read_calls.append(kwargs)
        return None

    async def _fetch_default_project(*, workspace_or_organization_id):
        from oss.src.services.db_manager import DefaultProjectRef

        return DefaultProjectRef(
            project_id=world.project.project_id,
            project_organization_id=world.project.organization_id,
            project_workspace_id=world.project.workspace_id,
            ref_workspace_id=world.project.workspace_id,
            ref_organization_id=world.project.organization_id,
        )

    monkeypatch.setattr(world.service, "read_membership", _read_membership)
    monkeypatch.setattr(
        auth.db_manager, "fetch_default_project", _fetch_default_project
    )

    with pytest.raises(HTTPException) as error:
        await auth.verify_bearer_token(
            request=_request(),
            bearer_token="token",
            query_workspace_id=str(world.project.workspace_id),
        )

    assert error.value.status_code == 401
    assert read_calls == [
        {"user_id": world.user, "project_id": world.project.project_id}
    ]
