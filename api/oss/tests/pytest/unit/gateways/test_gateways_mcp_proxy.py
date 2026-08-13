"""Unit tests for McpGatewayProxy routing (entities.md §9, workstreams/specs-wp8.md).

In-process ASGI against a fake `McpGatewayService` and a faked `get_auth_scope()` — no
Postgres, no real service, no network. Asserts which handler each path reaches (the
catch-all nesting on `agenta`, the three fixed segments on `builtin`), the 405s on the
stream verbs, and the exception -> HTTP status mapping via the seed's
`handle_gateway_exceptions()`.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.proxy import McpGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.interfaces import McpRelayResult
from oss.src.core.gateways.mcps.types import (
    McpEndpointNotFoundError,
    McpToolNotAllowedError,
    McpUpstreamError,
)
from oss.src.utils.context import AuthScope


class _FakeMcpGatewayService:
    def __init__(self):
        self.calls = []
        self.raise_error = None

    async def relay(self, **kwargs):
        self.calls.append(kwargs)
        if self.raise_error is not None:
            raise self.raise_error
        return McpRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=b'{"jsonrpc": "2.0", "id": 1, "result": {}}',
        )


@pytest.fixture
def fake_service():
    return _FakeMcpGatewayService()


@pytest.fixture
def client(fake_service, monkeypatch):
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.proxy.get_auth_scope",
        lambda: scope,
    )

    proxy = McpGatewayProxy(mcp_gateway_service=fake_service)
    app = FastAPI()
    app.include_router(proxy.router)
    return TestClient(app)


def test_agenta_catchall_nests_the_slug(client, fake_service):
    response = client.post(
        "/agenta/tools/search",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = fake_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.AGENTA
    assert call["name"] == "tools/search"


def test_builtin_reaches_with_three_segments(client, fake_service):
    response = client.post(
        "/builtin/composio/notion/my-notion",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = fake_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.BUILTIN
    assert call["provider"] == "composio"
    assert call["integration"] == "notion"
    assert call["name"] == "my-notion"


def test_custom_reaches_with_the_slug(client, fake_service):
    response = client.post(
        "/custom/acme-notion",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = fake_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert call["name"] == "acme-notion"
    assert call["provider"] is None
    assert call["integration"] is None


@pytest.mark.parametrize(
    "path",
    [
        "/agenta/tools/search",
        "/builtin/composio/notion/my-notion",
        "/custom/acme-notion",
    ],
)
def test_get_and_delete_return_405(client, path):
    assert client.get(path).status_code == 405
    assert client.delete(path).status_code == 405


def test_missing_mcp_method_header_returns_400(client, fake_service):
    response = client.post("/custom/acme-notion", content=b"{}")

    assert response.status_code == 400
    assert fake_service.calls == []


def test_endpoint_not_found_maps_to_404(client, fake_service):
    fake_service.raise_error = McpEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="missing"
    )

    response = client.post(
        "/custom/missing", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == 404


def test_tool_not_allowed_maps_to_403(client, fake_service):
    fake_service.raise_error = McpToolNotAllowedError(
        tool="danger", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-notion"
    )

    response = client.post(
        "/custom/acme-notion",
        headers={"Mcp-Method": "tools/call", "Mcp-Name": "danger"},
        content=b"{}",
    )

    assert response.status_code == 403


def test_upstream_error_below_500_maps_to_424(client, fake_service):
    fake_service.raise_error = McpUpstreamError(
        target="http://upstream", status_code=400
    )

    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == 424


def test_upstream_error_5xx_maps_to_502(client, fake_service):
    fake_service.raise_error = McpUpstreamError(
        target="http://upstream", status_code=503
    )

    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == 502


def test_relayed_body_and_status_pass_through_untouched(client, fake_service):
    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == 200
    assert response.content == b'{"jsonrpc": "2.0", "id": 1, "result": {}}'


def test_authorization_header_is_not_forwarded_to_the_service(client, fake_service):
    client.post(
        "/custom/acme-notion",
        headers={"Mcp-Method": "tools/list", "Authorization": "Secret platform-token"},
        content=b"{}",
    )

    forwarded_headers = fake_service.calls[0]["headers"]
    assert "authorization" not in {k.lower() for k in forwarded_headers}
