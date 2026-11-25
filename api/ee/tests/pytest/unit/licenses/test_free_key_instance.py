"""A free registration key works only on the instance it was issued for."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import ee.src.core.licenses.service as licenses_service_module
import oss.src.apis.fastapi.licenses.router as licenses_router
from oss.src.apis.fastapi.licenses.models import InstanceLicenseActivateRequest
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind
from oss.src.utils.env import env

from ee.src.core.licenses.service import LicensesService
from ee.src.core.licenses.types import InvalidLicenseKey

from .conftest import REGISTRATION, sign_key

THIS_INSTANCE = uuid4()


@pytest.fixture
def instance(monkeypatch):
    monkeypatch.setattr(
        licenses_service_module,
        "_this_instance_id",
        AsyncMock(return_value=THIS_INSTANCE),
    )


def _free_key(registration_key, **fields):
    return sign_key(
        registration_key,
        signing_key_id=REGISTRATION,
        plan="self_hosted_registered",
        seats=None,
        expires_at=None,
        **fields,
    )


def _service(stored_key=None) -> LicensesService:
    return LicensesService(
        licenses_dao=SimpleNamespace(
            read=AsyncMock(
                return_value=SimpleNamespace(key=stored_key) if stored_key else None
            ),
            replace=AsyncMock(),
        )
    )


@pytest.mark.asyncio
async def test_a_free_key_for_this_instance_is_accepted(
    self_hosted, instance, registration_key
):
    service = _service()

    state = await service.activate(
        key=_free_key(registration_key, instance_id=str(THIS_INSTANCE)),
        user_id=uuid4(),
    )

    assert state.plan == "self_hosted_registered"
    service.licenses_dao.replace.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_free_key_for_another_instance_is_refused(
    self_hosted, instance, registration_key
):
    service = _service()

    with pytest.raises(InvalidLicenseKey) as error:
        await service.activate(
            key=_free_key(registration_key, instance_id=str(uuid4())),
            user_id=uuid4(),
        )

    assert error.value.reason == "other_instance"
    service.licenses_dao.replace.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_free_key_without_an_instance_is_refused(
    self_hosted, instance, registration_key
):
    with pytest.raises(InvalidLicenseKey) as error:
        await _service().activate(key=_free_key(registration_key), user_id=uuid4())

    assert error.value.reason == "other_instance"


@pytest.mark.asyncio
async def test_a_paid_key_is_not_tied_to_an_instance(
    self_hosted, instance, signing_key
):
    state = await _service().activate(key=sign_key(signing_key), user_id=uuid4())

    assert state.plan == "self_hosted_enterprise"


@pytest.mark.asyncio
async def test_a_stored_free_key_of_another_instance_gives_the_community_plan(
    self_hosted, instance, registration_key
):
    service = _service(_free_key(registration_key, instance_id=str(uuid4())))

    assert await service.instance_plan() == "self_hosted_community"


@pytest.mark.asyncio
async def test_a_free_key_in_the_environment_for_another_instance_is_ignored(
    self_hosted, instance, registration_key, monkeypatch
):
    monkeypatch.setattr(
        env.license, "key", _free_key(registration_key, instance_id=str(uuid4()))
    )

    state = await _service().read_state()

    assert state.source == "environment"
    assert state.license is None


@pytest.mark.asyncio
async def test_the_route_says_the_free_key_is_for_another_instance(
    self_hosted, instance, registration_key, monkeypatch
):
    user_id = uuid4()
    access = SimpleNamespace(
        credential_kind=RequestCredentialKind.BEARER_SESSION,
        envelope=None,
        principal=SimpleNamespace(kind=PrincipalKind.HUMAN, id=user_id),
        acting_user_id=user_id,
    )
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: access)
    monkeypatch.setattr(
        licenses_router, "is_instance_admin", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(licenses_service_module, "_service", _service())

    with pytest.raises(HTTPException) as error:
        await licenses_router.LicensesRouter().activate_instance_license(
            request=None,
            body=InstanceLicenseActivateRequest(
                key=_free_key(registration_key, instance_id=str(uuid4()))
            ),
        )

    assert error.value.status_code == 400
    assert error.value.detail["code"] == "other_instance"
