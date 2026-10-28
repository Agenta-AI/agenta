"""Step 2b: a route segment that names no organization (a legacy workspace id) is a 404,
not a 500."""

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import NoResultFound

from oss.src.services import organization_service


@pytest.mark.parametrize("error", [NoResultFound("none"), ValueError("not a uuid")])
async def test_an_unknown_workspace_segment_is_a_404(monkeypatch, error):
    async def _missing(workspace_id, **_):
        raise error

    monkeypatch.setattr(
        organization_service.db_manager, "get_project_by_workspace", _missing
    )
    with pytest.raises(HTTPException) as caught:
        await organization_service.get_project_of_workspace_ref("legacy-id")
    assert caught.value.status_code == 404


async def test_an_organization_segment_answers_its_project(monkeypatch):
    project = object()

    async def _found(workspace_id, **_):
        return project

    monkeypatch.setattr(
        organization_service.db_manager, "get_project_by_workspace", _found
    )
    assert await organization_service.get_project_of_workspace_ref("org") is project
