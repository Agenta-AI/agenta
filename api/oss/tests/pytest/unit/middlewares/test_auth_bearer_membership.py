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

    workspace_checks = []

    async def _workspace_member_exists(**kwargs):
        workspace_checks.append(kwargs)
        return False

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
        auth.db_manager, "workspace_member_exists", _workspace_member_exists
    )
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
        workspace_checks=workspace_checks,
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


async def test_bearer_workspace_branch_keeps_the_workspace_check(world, monkeypatch):
    resolve_calls = []

    async def _resolve(**kwargs):
        resolve_calls.append(kwargs)
        return None

    monkeypatch.setattr(world.service, "resolve", _resolve)

    with pytest.raises(HTTPException) as error:
        await auth.verify_bearer_token(
            request=_request(),
            bearer_token="token",
            query_workspace_id=str(world.project.workspace_id),
        )

    assert error.value.status_code == 401
    assert world.workspace_checks == [
        {"workspace_id": str(world.project.workspace_id), "user_id": str(world.user)}
    ]
    assert resolve_calls == []
