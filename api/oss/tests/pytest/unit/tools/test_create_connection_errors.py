"""Unit tests for POST /tools/connections/ adapter-error mapping.

Regression for a live 500: Composio has no managed ("use_composio_managed_auth")
auth config for some toolkits (e.g. telegram) and rejects auth-config creation
with a 404 telling the caller to use ``use_custom_auth`` instead. The gateway
adapter wraps that as a ``ConnectionAdapterError``
(``oss.src.core.gateway.connections.exceptions.AdapterError``), which the
router previously let fall through to the generic ``@intercept_exceptions``
handler -> a bare, unactionable 500. It must now surface as a 422 with a
message telling the user this toolkit needs custom OAuth credentials in this
environment.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.tools.models import ToolConnectionCreateRequest
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.gateway.connections.exceptions import (
    AdapterError as ConnectionAdapterError,
)
from oss.src.core.tools.dtos import ToolConnectionCreate, ToolProviderKind


def _router(*, create_connection):
    tools_service = SimpleNamespace(create_connection=create_connection)
    return ToolsRouter(tools_service=tools_service)


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )


def _body(integration_key: str = "telegram") -> ToolConnectionCreateRequest:
    return ToolConnectionCreateRequest(
        connection=ToolConnectionCreate(
            slug=f"conn-{uuid4().hex[:8]}",
            provider_key=ToolProviderKind.COMPOSIO,
            integration_key=integration_key,
        )
    )


async def test_create_connection_no_managed_auth_config_returns_422(monkeypatch):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    async def _create_connection(**_kwargs):
        raise ConnectionAdapterError(
            provider_key="composio",
            operation="initiate_connection.create_auth_config",
            detail=(
                'Default auth config not found for toolkit "telegram" and no '
                "input auth config id found. Use type use_custom_auth with "
                "your own credentials instead."
            ),
        )

    router = _router(create_connection=_create_connection)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_connection(_request(), body=_body("telegram"))

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert "telegram" in detail
    assert "custom OAuth credentials" in detail
    # The old opaque generic-500 message must not leak through.
    assert "unexpected error" not in detail.lower()


async def test_create_connection_other_adapter_error_returns_422_with_upstream_detail(
    monkeypatch,
):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    async def _create_connection(**_kwargs):
        raise ConnectionAdapterError(
            provider_key="composio",
            operation="initiate_connection.link_account",
            detail="mutually exclusive fields: auth_config_id, integration_id",
        )

    router = _router(create_connection=_create_connection)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_connection(_request(), body=_body("github"))

    assert exc_info.value.status_code == 422
    assert "mutually exclusive fields" in exc_info.value.detail


async def test_create_connection_success_returns_connection(monkeypatch):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    from oss.src.core.tools.dtos import ToolConnection

    expected = ToolConnection(
        id=uuid4(),
        slug="conn-github",
        provider_key=ToolProviderKind.COMPOSIO,
        integration_key="github",
    )

    async def _create_connection(**_kwargs):
        return expected

    router = _router(create_connection=_create_connection)

    response = await router.create_connection(_request(), body=_body("github"))

    assert response.count == 1
    assert response.connection == expected
