import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import oss.src.apis.fastapi.licenses.router as licenses_router
import oss.src.core.licenses.registrations as registrations
from oss.src.apis.fastapi.licenses.models import InstanceRegistrationRequest
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind
from oss.src.utils.env import env

INSTANCE_ID = uuid4()


@pytest.fixture
def agenta(monkeypatch):
    """The registration endpoint of Agenta, answering `status`; records each call."""
    state = SimpleNamespace(status=202, calls=[])

    def handler(request: httpx.Request) -> httpx.Response:
        state.calls.append(request)
        return httpx.Response(state.status, json={})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        registrations.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(
        registrations, "_instance_id", AsyncMock(return_value=INSTANCE_ID)
    )
    monkeypatch.setattr(registrations, "_agenta_version", lambda: "v0.128.11")
    return state


@pytest.fixture
def admin(monkeypatch):
    user_id = uuid4()
    access = SimpleNamespace(
        credential_kind=RequestCredentialKind.BEARER_SESSION,
        envelope=None,
        principal=SimpleNamespace(kind=PrincipalKind.HUMAN, id=user_id),
        acting_user_id=user_id,
    )
    monkeypatch.setattr(licenses_router, "get_request_access", lambda: access)
    is_admin = AsyncMock(return_value=True)
    monkeypatch.setattr(licenses_router, "is_instance_admin", is_admin)
    monkeypatch.setattr(env.stripe, "api_key", None)
    monkeypatch.setattr(env.agenta, "web_url", "https://agenta.example.com")
    return is_admin


async def _register(email="ada@example.com", product_updates=True):
    return await licenses_router.LicensesRouter().create_instance_registration(
        request=None,
        body=InstanceRegistrationRequest(email=email, product_updates=product_updates),
    )


@pytest.mark.asyncio
async def test_registration_sends_the_instance_details_to_agenta(admin, agenta):
    response = await _register()

    assert response.model_dump() == {"email": "ada@example.com"}
    assert len(agenta.calls) == 1
    call = agenta.calls[0]
    assert str(call.url) == registrations.REGISTRATION_URL
    assert json.loads(call.content) == {
        "email": "ada@example.com",
        "instance_id": str(INSTANCE_ID),
        "agenta_version": "v0.128.11",
        "web_url": "https://agenta.example.com",
    }


@pytest.mark.asyncio
async def test_registration_without_consent_to_product_updates_gets_400(admin, agenta):
    with pytest.raises(HTTPException) as error:
        await _register(product_updates=False)

    assert error.value.status_code == 400
    assert agenta.calls == []


def test_registration_refuses_a_value_that_is_not_an_email():
    with pytest.raises(ValidationError):
        InstanceRegistrationRequest(email="not-an-email", product_updates=True)


@pytest.mark.asyncio
async def test_registration_answers_502_when_agenta_fails(admin, agenta):
    agenta.status = 500

    with pytest.raises(HTTPException) as error:
        await _register()

    assert error.value.status_code == 502
    assert error.value.detail == "We could not reach Agenta. Try again later."


@pytest.mark.asyncio
async def test_registration_by_a_user_who_is_not_the_instance_admin_gets_403(
    admin, agenta
):
    admin.return_value = False

    with pytest.raises(HTTPException) as error:
        await _register()

    assert error.value.status_code == 403
    assert agenta.calls == []


@pytest.mark.asyncio
async def test_registration_with_stripe_answers_404(admin, agenta, monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_unit")

    with pytest.raises(HTTPException) as error:
        await _register()

    assert error.value.status_code == 404
    assert agenta.calls == []


@pytest.mark.asyncio
async def test_registration_answers_502_when_the_instance_id_is_not_wired(
    admin, agenta, monkeypatch
):
    def missing():
        raise ModuleNotFoundError(name="oss.src.core.instances.service")

    monkeypatch.setattr(registrations, "_instance_id", AsyncMock(side_effect=missing))

    with pytest.raises(HTTPException) as error:
        await _register()

    assert error.value.status_code == 502
    assert agenta.calls == []
