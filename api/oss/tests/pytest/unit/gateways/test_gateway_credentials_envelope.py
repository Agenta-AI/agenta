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
