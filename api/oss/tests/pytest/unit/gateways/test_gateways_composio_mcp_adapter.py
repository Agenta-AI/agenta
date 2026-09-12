"""Contract tests for the built-in, deployment-owned Composio MCP relay."""

import json
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateway.connections.dtos import Connection, ConnectionProviderKind
from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.composio import ComposioMCPAdapter
from oss.src.core.gateways.mcps.types import MCPUpstreamError


def _connection(*, no_auth: bool = False, integration_key: str = "gmail") -> Connection:
    data = {
        "project_id": "project-composio-user",
        "no_auth": no_auth,
    }
    if not no_auth:
        data["connected_account_id"] = "ca_gmail_123"
    return Connection(
        id=uuid4(),
        slug="my-gmail",
        name="My Gmail",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key=integration_key,
        flags={"is_active": True, "is_valid": True},
        data=data,
    )


def _auth(*, no_auth: bool = False, integration_key: str = "gmail") -> MCPBrokeredAuth:
    return MCPBrokeredAuth(
        connection=_connection(no_auth=no_auth, integration_key=integration_key)
    )


def _adapter(handler) -> ComposioMCPAdapter:
    return ComposioMCPAdapter(
        api_key="platform-composio-key",
        api_url="https://backend.composio.test/api/v3.1",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_creates_a_connection_scoped_session_then_relays_raw_jsonrpc():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/v3.1/tool_router/session":
            return httpx.Response(
                201,
                json={
                    "session_id": "trs_123",
                    "mcp": {
                        "type": "http",
                        "url": "https://app.composio.test/tool_router/v3/trs_123/mcp",
                        "headers": {"Authorization": "Bearer session-capability"},
                    },
                },
            )
        assert request.url == "https://app.composio.test/tool_router/v3/trs_123/mcp"
        return httpx.Response(
            200,
            headers={"x-composio-request-id": "req_123"},
            content=b'{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}',
        )

    adapter = _adapter(handler)
    body = b'{"jsonrpc":"2.0", "id":7, "method":"tools/list"}'

    result = await adapter.relay(
        route=MCPResolvedRoute(url="composio://composio/gmail/my-gmail"),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=body,
        headers={
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2026-07-28",
            "Authorization": "Bearer caller-controlled",
            "X-AG-Credentials": "short-lived-gateway-token",
            "Host": "api.agenta.test",
        },
    )

    assert result.status_code == 200
    assert result.body == b'{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}'
    assert result.headers["x-composio-request-id"] == "req_123"
    assert len(requests) == 2

    session_request, mcp_request = requests
    assert session_request.headers["x-api-key"] == "platform-composio-key"
    assert json.loads(session_request.content) == {
        "user_id": "project-composio-user",
        "mcp": True,
        "toolkits": {"enabled": ["gmail"]},
        "connected_accounts": {"gmail": ["ca_gmail_123"]},
    }
    assert mcp_request.content == body
    assert mcp_request.headers["mcp-protocol-version"] == "2026-07-28"
    assert "x-ag-credentials" not in mcp_request.headers
    assert "x-api-key" not in mcp_request.headers
    assert mcp_request.headers["authorization"] == "Bearer session-capability"


@pytest.mark.asyncio
async def test_reuses_its_internal_capability_url_for_a_connection():
    session_calls = 0
    mcp_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal session_calls, mcp_calls
        if request.url.path == "/api/v3.1/tool_router/session":
            session_calls += 1
            return httpx.Response(
                201,
                json={"mcp": {"url": "https://app.composio.test/mcp/session"}},
            )
        mcp_calls += 1
        return httpx.Response(200, content=b"{}")

    adapter = _adapter(handler)
    auth = _auth()
    for _ in range(2):
        await adapter.relay(
            route=MCPResolvedRoute(url="composio://composio/gmail/my-gmail"),
            auth=auth,
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
        )

    assert session_calls == 1
    assert mcp_calls == 2


@pytest.mark.asyncio
async def test_no_auth_connection_does_not_pin_a_connected_account():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v3.1/tool_router/session":
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                201,
                json={"mcp": {"url": "https://app.composio.test/mcp/session"}},
            )
        return httpx.Response(200, content=b"{}")

    await _adapter(handler).relay(
        route=MCPResolvedRoute(url="composio://composio/codeinterpreter/local"),
        auth=_auth(no_auth=True, integration_key="codeinterpreter"),
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    assert captured["body"] == {
        "user_id": "project-composio-user",
        "mcp": True,
        "toolkits": {"enabled": ["codeinterpreter"]},
    }


@pytest.mark.asyncio
async def test_rejects_a_malformed_or_non_https_session_url():
    adapter = _adapter(
        lambda request: httpx.Response(
            201, json={"mcp": {"url": "http://localhost:9999/mcp"}}
        )
    )

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url="composio://composio/gmail/my-gmail"),
            auth=_auth(),
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
        )
    assert excinfo.value.detail == "session creation returned no valid HTTPS MCP URL"


@pytest.mark.asyncio
async def test_rejects_direct_secret_authentication():
    adapter = _adapter(lambda request: httpx.Response(500))

    with pytest.raises(TypeError, match="MCPBrokeredAuth only"):
        await adapter.relay(
            route=MCPResolvedRoute(url="composio://composio/gmail/my-gmail"),
            auth=MCPDirectAuth(),
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
        )
