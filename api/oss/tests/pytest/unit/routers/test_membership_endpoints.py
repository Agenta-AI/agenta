"""The legacy workspace and organization membership endpoints."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.routers.organization_router as organization_router
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


async def test_update_workspace_checks_edit_workspace(monkeypatch, project):
    access = _Recorder(result=False)

    async def _get_project_by_workspace(workspace_id):
        return project

    monkeypatch.setattr(organization_router, "check_action_access", access)
    monkeypatch.setattr(
        organization_router.db_manager,
        "get_project_by_workspace",
        _get_project_by_workspace,
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
