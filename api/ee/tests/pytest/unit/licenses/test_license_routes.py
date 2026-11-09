from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.apis.fastapi.licenses.router as licenses_router
from oss.src.apis.fastapi.licenses.models import InstanceLicenseActivateRequest
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind

import ee.src.core.licenses.service as licenses_service_module
from ee.src.core.licenses.service import LicensesService

from .conftest import sign_key


def _access(*, kind=RequestCredentialKind.BEARER_SESSION, user_id=None):
    user_id = user_id or uuid4()
    return SimpleNamespace(
        credential_kind=kind,
        envelope=None,
        principal=SimpleNamespace(kind=PrincipalKind.HUMAN, id=user_id),
        acting_user_id=user_id,
    )


@pytest.fixture
def wired(monkeypatch, self_hosted, signing_key):
    """A signed-in instance admin, a licenses service with no stored key, 3 users."""
    access = _access()
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: access)
    is_admin = AsyncMock(return_value=True)
    monkeypatch.setattr(licenses_router, "is_instance_admin", is_admin)
    monkeypatch.setattr(licenses_router, "count_users", AsyncMock(return_value=3))
    dao = SimpleNamespace(read=AsyncMock(return_value=None), replace=AsyncMock())
    service = LicensesService(licenses_dao=dao)
    monkeypatch.setattr(licenses_service_module, "_service", service)
    return SimpleNamespace(access=access, is_admin=is_admin, dao=dao)


@pytest.mark.asyncio
async def test_get_without_a_key_reports_the_community_plan(wired):
    response = await licenses_router.LicensesRouter().fetch_instance_license(
        request=None
    )

    assert response.model_dump() == {
        "plan": "self_hosted_community",
        "source": None,
        "license": None,
        "usage": {"users": 3},
    }


@pytest.mark.asyncio
async def test_put_activates_a_valid_key(wired, signing_key):
    response = await licenses_router.LicensesRouter().activate_instance_license(
        request=None,
        body=InstanceLicenseActivateRequest(key=sign_key(signing_key, seats=10)),
    )

    assert response.plan == "self_hosted_enterprise"
    assert response.source == "database"
    assert response.license.seats == 10
    wired.dao.replace.assert_awaited_once()
    assert wired.dao.replace.await_args.kwargs["created_by_id"] == (
        wired.access.principal.id
    )


@pytest.mark.asyncio
async def test_put_answers_400_for_a_key_that_is_not_valid(wired):
    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().activate_instance_license(
            request=None,
            body=InstanceLicenseActivateRequest(key="agenta_license_v1.abc.def"),
        )

    assert error.value.status_code == 400
    assert error.value.detail == "This license key is not valid"


@pytest.mark.asyncio
async def test_put_answers_409_when_the_key_is_in_the_environment(
    wired, signing_key, monkeypatch
):
    monkeypatch.setattr(licenses_router.env.license, "key", sign_key(signing_key))

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().activate_instance_license(
            request=None,
            body=InstanceLicenseActivateRequest(key=sign_key(signing_key)),
        )

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_a_user_who_is_not_the_instance_admin_gets_403(wired):
    wired.is_admin.return_value = False

    for call in (
        licenses_router.LicensesRouter().fetch_instance_license(request=None),
        licenses_router.LicensesRouter().activate_instance_license(
            request=None, body=InstanceLicenseActivateRequest(key="x")
        ),
    ):
        with pytest.raises(HTTPException) as error:
            await call
        assert error.value.status_code == 403
    wired.dao.replace.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_api_key_of_the_instance_admin_gets_403(wired, monkeypatch):
    access = _access(kind=RequestCredentialKind.API_KEY)
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: access)

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_instance_license(request=None)

    assert error.value.status_code == 403
    wired.is_admin.assert_not_awaited()


@pytest.mark.asyncio
async def test_with_stripe_the_routes_answer_404(wired, cloud):
    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().fetch_instance_license(request=None)

    assert error.value.status_code == 404
