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
