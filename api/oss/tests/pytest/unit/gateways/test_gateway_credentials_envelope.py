"""`POST /gateways/credentials` mints with the caller's run envelope (M2)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.apis.fastapi.gateways.credentials_router as credentials_router
from oss.src.apis.fastapi.gateways.credentials_router import GatewayCredentialsRouter
from oss.src.utils.context import AuthScope
from oss.tests.pytest.utils.principals import make_envelope


@pytest.fixture
def signer(monkeypatch):
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    monkeypatch.setattr(credentials_router, "get_auth_scope", lambda: scope)
    mock = AsyncMock(return_value="signed")
    monkeypatch.setattr(credentials_router, "sign_secret_token", mock)
    return mock


async def test_gateway_mint_copies_the_run_envelope(signer):
    envelope = make_envelope(run_id="turn-3")
    request = SimpleNamespace(
        state=SimpleNamespace(run_envelope=envelope),
        headers={},
    )
    response = await GatewayCredentialsRouter().issue_gateway_credentials(request)
    assert response.credentials == "Secret signed"
    assert signer.await_args.kwargs["envelope"] == envelope


async def test_a_request_without_a_principal_gets_no_credential(signer):
    from fastapi import HTTPException

    request = SimpleNamespace(state=SimpleNamespace(), headers={})
    with pytest.raises(HTTPException) as error:
        await GatewayCredentialsRouter().issue_gateway_credentials(request)
    assert error.value.status_code == 401
    signer.assert_not_awaited()


# -- eligibility (steps 1 and 2 of decide) -------------------------------------------


@pytest.mark.parametrize("kind", ["bearer_session", "api_key", "run_credential"])
async def test_gateway_credentials_pass_the_auth_scope_project(
    signer, monkeypatch, kind
):
    from oss.tests.pytest.utils.principals import (  # noqa: PLC0415
        AllowingAccessService,
        make_request_access,
    )

    envelope = make_envelope(kind="human" if kind == "bearer_session" else "api_key")
    access = make_request_access(envelope=envelope, credential_kind=kind)
    service = AllowingAccessService()
    monkeypatch.setattr(credentials_router, "get_request_access", lambda: access)
    monkeypatch.setattr(credentials_router, "get_access_service", lambda: service)
    scope = credentials_router.get_auth_scope()

    request = SimpleNamespace(state=SimpleNamespace(run_envelope=envelope), headers={})
    await GatewayCredentialsRouter().issue_gateway_credentials(request)

    call = service.decisions[-1]
    assert call["project_id"] == scope.project_id
    assert call["principal"] == access.principal
    if kind == "bearer_session":
        assert call["authority"] is None
    else:
        assert call["authority"] == access.authority


async def test_gateway_credentials_refuse_deleted_key(signer, monkeypatch):
    from fastapi import HTTPException  # noqa: PLC0415

    from oss.src.core.access.dtos import DecisionReason  # noqa: PLC0415
    from oss.tests.pytest.utils.principals import (  # noqa: PLC0415
        DenyingAccessService,
        make_request_access,
    )

    envelope = make_envelope(kind="api_key")
    access = make_request_access(envelope=envelope, credential_kind="api_key")
    monkeypatch.setattr(credentials_router, "get_request_access", lambda: access)
    monkeypatch.setattr(
        credentials_router,
        "get_access_service",
        lambda: DenyingAccessService(reason=DecisionReason.PRINCIPAL_INACTIVE),
    )

    request = SimpleNamespace(state=SimpleNamespace(run_envelope=envelope), headers={})
    with pytest.raises(HTTPException) as error:
        await GatewayCredentialsRouter().issue_gateway_credentials(request)
    assert error.value.status_code == 403
    assert error.value.detail["code"] == "access_denied"
    assert error.value.detail["details"]["reason"] == "principal_inactive"
    assert error.value.detail["details"]["principal_kind"] == "api_key"
    signer.assert_not_awaited()
