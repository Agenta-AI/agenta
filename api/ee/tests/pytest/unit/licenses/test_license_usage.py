"""Project and organization counts against the plan limits."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import ee.src.core.access.entitlements.service as entitlements_service
import oss.src.apis.fastapi.licenses.router as licenses_router
import oss.src.core.licenses.usage as usage
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind

ORGANIZATION = uuid4()


@pytest.fixture
def counts(monkeypatch):
    monkeypatch.setattr(usage, "is_ee", lambda: True)
    monkeypatch.setattr(
        entitlements_service.db_manager,
        "count_organization_projects",
        AsyncMock(return_value=1),
    )
    monkeypatch.setattr(
        entitlements_service.db_manager,
        "count_organizations",
        AsyncMock(return_value=1),
    )


def _plan(monkeypatch, plan, *, cloud=False):
    monkeypatch.setattr(entitlements_service, "is_cloud", lambda: cloud)
    monkeypatch.setattr(entitlements_service, "plan_for", AsyncMock(return_value=plan))
    monkeypatch.setattr(
        entitlements_service, "instance_plan", AsyncMock(return_value=plan)
    )


@pytest.mark.asyncio
async def test_community_has_one_project_and_one_organization(counts, monkeypatch):
    _plan(monkeypatch, "self_hosted_community")

    assert await usage.project_usage(ORGANIZATION) == {"count": 1, "limit": 1}
    assert await usage.organization_usage() == {"count": 1, "limit": 1}


@pytest.mark.asyncio
async def test_the_free_key_lifts_the_project_limit_only(counts, monkeypatch):
    _plan(monkeypatch, "self_hosted_registered")

    assert await usage.project_usage(ORGANIZATION) == {"count": 1, "limit": None}
    assert await usage.organization_usage() == {"count": 1, "limit": 1}


@pytest.mark.asyncio
async def test_enterprise_has_no_limits(counts, monkeypatch):
    _plan(monkeypatch, "self_hosted_enterprise")

    assert (await usage.project_usage(ORGANIZATION))["limit"] is None
    assert (await usage.organization_usage())["limit"] is None


@pytest.mark.asyncio
async def test_cloud_reports_no_organization_usage(counts, monkeypatch):
    # Cloud has no organization limit; its projects keep the Hobby limit.
    _plan(monkeypatch, "cloud_v0_hobby", cloud=True)

    assert await usage.project_usage(ORGANIZATION) == {"count": 1, "limit": 1}
    assert await usage.organization_usage() is None
    entitlements_service.db_manager.count_organizations.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_failed_plan_read_reports_no_usage(counts, monkeypatch):
    _plan(monkeypatch, None)
    failed = AsyncMock(side_effect=ConnectionError("database down"))
    monkeypatch.setattr(entitlements_service, "plan_for", failed)
    monkeypatch.setattr(entitlements_service, "instance_plan", failed)

    assert await usage.project_usage(ORGANIZATION) is None
    assert await usage.organization_usage() is None


@pytest.mark.asyncio
async def test_the_oss_image_reports_no_usage(monkeypatch):
    monkeypatch.setattr(usage, "is_ee", lambda: False)

    assert await usage.project_usage(ORGANIZATION) is None
    assert await usage.organization_usage() is None


def _access(kind=RequestCredentialKind.BEARER_SESSION):
    user_id = uuid4()
    return SimpleNamespace(
        credential_kind=kind,
        envelope=None,
        principal=SimpleNamespace(kind=PrincipalKind.HUMAN, id=user_id),
        acting_user_id=user_id,
    )


@pytest.mark.asyncio
async def test_a_member_reads_the_usage_of_their_organization(monkeypatch):
    monkeypatch.setattr(licenses_router, "_is_cloud", lambda: False)
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: _access())
    projects = AsyncMock(return_value={"count": 1, "limit": 1})
    monkeypatch.setattr(licenses_router, "project_usage", projects)
    monkeypatch.setattr(
        licenses_router,
        "organization_usage",
        AsyncMock(return_value={"count": 1, "limit": 1}),
    )
    request = SimpleNamespace(state=SimpleNamespace(organization_id=str(ORGANIZATION)))

    response = await licenses_router.LicensesRouter().fetch_license_usage(request)

    assert response.model_dump() == {
        "projects": {"count": 1, "limit": 1},
        "organizations": {"count": 1, "limit": 1},
    }
    projects.assert_awaited_once_with(ORGANIZATION)


@pytest.mark.asyncio
async def test_an_api_key_cannot_read_the_usage(monkeypatch):
    monkeypatch.setattr(licenses_router, "_is_cloud", lambda: False)
    monkeypatch.setattr(
        licenses_router,
        "get_request_access",
        lambda: _access(RequestCredentialKind.API_KEY),
    )

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_license_usage(
            SimpleNamespace(state=SimpleNamespace())
        )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_the_usage_is_not_on_cloud(monkeypatch):
    monkeypatch.setattr(licenses_router, "_is_cloud", lambda: True)

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_license_usage(
            SimpleNamespace(state=SimpleNamespace())
        )

    assert error.value.status_code == 404
