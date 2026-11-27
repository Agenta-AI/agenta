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
    ProjectLimitReachedError,
)

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
SELF_HOSTED = DefaultPlan.SELF_HOSTED_ENTERPRISE.value
COMMUNITY = DefaultPlan.SELF_HOSTED_COMMUNITY.value
REGISTERED = DefaultPlan.SELF_HOSTED_REGISTERED.value

SELF_HOSTED_MESSAGE = (
    "This organization has reached its limit of 1 project(s). "
    "A free key gives more projects."
)


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
        (None, 5, False),
    ],
)
async def test_cloud_project_limit_is_one_project_on_hobby_only(
    monkeypatch, plan, projects, refused
):
    _wire(monkeypatch, plan=plan, projects=projects, cloud=True)

    if not refused:
        await entitlements_service.check_project_limit(uuid4())
        return

    with pytest.raises(ProjectLimitReachedError) as error:
        await entitlements_service.check_project_limit(uuid4())

    assert error.value.code == "project_limit_reached"
    assert error.value.limit == 1
    assert error.value.message == PROJECT_LIMIT_MESSAGE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "plan, projects, refused",
    [
        # No key, an expired key or an invalid key: the community plan.
        (COMMUNITY, 0, False),
        (COMMUNITY, 1, True),
        # Projects above the limit are kept; only a new one is refused.
        (COMMUNITY, 4, True),
        (REGISTERED, 1, False),
        (REGISTERED, 5, False),
        (SELF_HOSTED, 5, False),
    ],
)
async def test_self_hosted_project_limit_follows_the_instance_plan(
    monkeypatch, plan, projects, refused
):
    _wire(monkeypatch, plan=plan, projects=projects, cloud=False)

    if not refused:
        await entitlements_service.check_project_limit(uuid4())
        return

    with pytest.raises(ProjectLimitReachedError) as error:
        await entitlements_service.check_project_limit(uuid4())

    assert error.value.limit == 1
    assert error.value.message == SELF_HOSTED_MESSAGE


@pytest.mark.asyncio
async def test_project_limit_fails_open_when_the_plan_read_fails(monkeypatch):
    _wire(monkeypatch, plan=None, projects=5, cloud=False)
    monkeypatch.setattr(
        entitlements_service,
        "plan_for",
        AsyncMock(side_effect=ConnectionError("redis down")),
    )

    await entitlements_service.check_project_limit(uuid4())


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            workspace_id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=str(uuid4()),
        )
    )


def _wire(monkeypatch, *, plan, projects, cloud=True):
    monkeypatch.setattr(entitlements_service, "plan_for", AsyncMock(return_value=plan))
    monkeypatch.setattr(entitlements_service, "is_cloud", lambda: cloud)
    monkeypatch.setattr(
        entitlements_service.db_manager,
        "count_organization_projects",
        AsyncMock(return_value=projects),
    )
    # The permission check allows; the create goes through MembershipsService.
    monkeypatch.setattr(
        projects_router.db_manager,
        "get_default_project_id_from_workspace",
        AsyncMock(return_value=str(uuid4())),
    )
    monkeypatch.setattr(
        projects_router, "check_action_access", AsyncMock(return_value=True)
    )
    create = AsyncMock(side_effect=_Created)
    monkeypatch.setattr(
        projects_router,
        "get_memberships_service",
        lambda: SimpleNamespace(create_project=create),
    )
    return create


async def _create_project():
    await projects_router.create_project(
        request=_request(),
        payload=projects_router.CreateProjectRequest(name="Second"),
    )


@pytest.mark.asyncio
async def test_create_project_is_refused_at_the_cloud_limit(monkeypatch):
    create = _wire(monkeypatch, plan=HOBBY, projects=1, cloud=True)

    with pytest.raises(HTTPException) as refused:
        await _create_project()

    assert refused.value.status_code == 403
    assert refused.value.detail == {
        "code": "project_limit_reached",
        "message": (
            "The Hobby plan includes 1 project. "
            "Upgrade to Starter for unlimited projects."
        ),
        "limit": 1,
    }
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_project_is_refused_without_a_key(monkeypatch):
    create = _wire(monkeypatch, plan=COMMUNITY, projects=1, cloud=False)

    with pytest.raises(HTTPException) as refused:
        await _create_project()

    assert refused.value.status_code == 403
    assert refused.value.detail == {
        "code": "project_limit_reached",
        "message": SELF_HOSTED_MESSAGE,
        "limit": 1,
    }
    create.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [REGISTERED, SELF_HOSTED])
async def test_create_project_goes_through_with_a_key(monkeypatch, plan):
    create = _wire(monkeypatch, plan=plan, projects=1, cloud=False)

    with pytest.raises(_Created):
        await _create_project()

    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_project_goes_through_under_the_limit(monkeypatch):
    create = _wire(monkeypatch, plan=HOBBY, projects=0)

    with pytest.raises(_Created):
        await _create_project()

    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_project_goes_through_when_the_plan_read_fails(monkeypatch):
    create = _wire(monkeypatch, plan=None, projects=1, cloud=False)
    monkeypatch.setattr(
        entitlements_service,
        "plan_for",
        AsyncMock(side_effect=ConnectionError("redis down")),
    )

    with pytest.raises(_Created):
        await _create_project()

    create.assert_awaited_once()
