from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import ee.src.core.access.entitlements.service as entitlements_service
import oss.src.routers.projects_router as projects_router
from ee.src.core.access.entitlements.types import (
    PROJECT_LIMIT_MESSAGE,
    DefaultPlan,
)

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
SELF_HOSTED = DefaultPlan.SELF_HOSTED_ENTERPRISE.value


class _Created(Exception):
    """Stops the handler once it reaches the insert: the check under test let it through."""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "plan, projects, refused",
    [
        (HOBBY, 0, False),
        (HOBBY, 1, True),
        # Grandfathered, or downgraded from Pro: keeps its projects, cannot add one.
        (HOBBY, 3, True),
        (PRO, 5, False),
        (BUSINESS, 5, False),
        (SELF_HOSTED, 5, False),
        (None, 5, False),
    ],
)
async def test_project_limit_refusal_is_one_project_on_hobby_only(
    monkeypatch, plan, projects, refused
):
    _wire(monkeypatch, plan=plan, projects=projects)

    refusal = await entitlements_service.project_limit_refusal(uuid4())

    assert refusal == (PROJECT_LIMIT_MESSAGE if refused else None)


@pytest.mark.asyncio
async def test_project_limit_fails_open_when_the_plan_read_fails(monkeypatch):
    _wire(monkeypatch, plan=None, projects=5)
    monkeypatch.setattr(
        entitlements_service,
        "plan_for",
        AsyncMock(side_effect=ConnectionError("redis down")),
    )

    assert await entitlements_service.project_limit_refusal(uuid4()) is None


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            workspace_id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=str(uuid4()),
        )
    )


def _wire(monkeypatch, *, plan, projects):
    monkeypatch.setattr(entitlements_service, "plan_for", AsyncMock(return_value=plan))
    monkeypatch.setattr(
        entitlements_service.db_manager,
        "count_organization_projects",
        AsyncMock(return_value=projects),
    )
    create = AsyncMock(side_effect=_Created)
    monkeypatch.setattr(projects_router.db_manager, "create_workspace_project", create)
    return create


async def _create_project():
    await projects_router.create_project(
        request=_request(),
        payload=projects_router.CreateProjectRequest(name="Second"),
    )


@pytest.mark.asyncio
async def test_create_project_is_refused_at_the_limit(monkeypatch):
    create = _wire(monkeypatch, plan=HOBBY, projects=1)

    with pytest.raises(HTTPException) as refused:
        await _create_project()

    assert refused.value.status_code == 403
    assert refused.value.detail == (
        "The Hobby plan includes 1 project. Upgrade to Starter for unlimited projects."
    )
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_project_goes_through_under_the_limit(monkeypatch):
    create = _wire(monkeypatch, plan=HOBBY, projects=0)

    with pytest.raises(_Created):
        await _create_project()

    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_oss_has_no_project_limit(monkeypatch):
    _wire(monkeypatch, plan=HOBBY, projects=5)
    monkeypatch.setattr(projects_router, "is_ee", lambda: False)

    with pytest.raises(_Created):
        await _create_project()

    projects_router.db_manager.count_organization_projects.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("plan, refused", [(HOBBY, True), (PRO, False)])
async def test_a_new_workspace_counts_as_a_new_project(monkeypatch, plan, refused):
    import oss.src.routers.organization_router as organization_router

    _wire(monkeypatch, plan=plan, projects=1)
    monkeypatch.setattr(
        organization_router, "_check_org_owner", AsyncMock(return_value=True)
    )
    create = AsyncMock(return_value="created")
    monkeypatch.setattr(
        organization_router.organization_service, "create_new_workspace", create
    )

    response = await organization_router.create_workspace(
        request=_request(),
        organization_id=str(uuid4()),
        payload=SimpleNamespace(name="Second"),
    )

    if refused:
        assert response.status_code == 403
        assert PROJECT_LIMIT_MESSAGE.encode() in response.body
        create.assert_not_awaited()
    else:
        assert response == "created"
