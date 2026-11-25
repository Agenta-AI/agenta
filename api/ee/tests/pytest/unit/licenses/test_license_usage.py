"""Project and organization counts against the plan limits."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import ee.src.core.access.entitlements.service as entitlements_service
import ee.src.core.licenses.service as licenses_service_module
import oss.src.apis.fastapi.licenses.router as licenses_router
import oss.src.core.licenses.usage as usage
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind

ORGANIZATION = uuid4()


@pytest.fixture
def counts(monkeypatch):
    monkeypatch.setattr(usage, "is_ee", lambda: True)
    monkeypatch.setattr(
        usage.db_manager, "count_organization_projects", AsyncMock(return_value=1)
    )
    monkeypatch.setattr(
        usage.db_manager, "count_organizations", AsyncMock(return_value=1)
    )


def _plan(monkeypatch, plan):
    monkeypatch.setattr(entitlements_service, "plan_for", AsyncMock(return_value=plan))
    monkeypatch.setattr(
        licenses_service_module, "instance_plan", AsyncMock(return_value=plan)
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
    monkeypatch.setattr(licenses_router, "is_cloud", lambda: False)
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: _access())
    projects = AsyncMock(return_value={"count": 1, "limit": 1})
    monkeypatch.setattr(licenses_router, "project_usage", projects)
    monkeypatch.setattr(
        licenses_router,
        "organization_usage",
        AsyncMock(return_value={"count": 1, "limit": 1}),
    )
    request = SimpleNamespace(state=SimpleNamespace(organization_id=str(ORGANIZATION)))

    response = await licenses_router.LicensesRouter().fetch_instance_usage(request)

    assert response.model_dump() == {
        "projects": {"count": 1, "limit": 1},
        "organizations": {"count": 1, "limit": 1},
    }
    projects.assert_awaited_once_with(ORGANIZATION)


@pytest.mark.asyncio
async def test_an_api_key_cannot_read_the_usage(monkeypatch):
    monkeypatch.setattr(licenses_router, "is_cloud", lambda: False)
    monkeypatch.setattr(
        licenses_router,
        "get_request_access",
        lambda: _access(RequestCredentialKind.API_KEY),
    )

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_instance_usage(
            SimpleNamespace(state=SimpleNamespace())
        )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_the_usage_is_not_on_cloud(monkeypatch):
    monkeypatch.setattr(licenses_router, "is_cloud", lambda: True)

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_instance_usage(
            SimpleNamespace(state=SimpleNamespace())
        )

    assert error.value.status_code == 404
