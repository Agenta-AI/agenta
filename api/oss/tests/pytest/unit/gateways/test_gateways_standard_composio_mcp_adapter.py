"""Unit coverage for project-key Composio MCP routing."""

import json
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.composio.standard import (
    StandardComposioMCPAdapter,
)
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.shared.dtos import Header


def _auth(key: str = "project-composio-key") -> MCPDirectAuth:
    return MCPDirectAuth(
        secret=ResolvedSecret(
            secret=SecretResponseDTO(
                id=uuid4(),
                slug="composio",
                header=Header(name="Composio"),
                kind=SecretKind.PROVIDER_KEY,
                data=StandardProviderDTO(
                    kind=StandardProviderKind.COMPOSIO,
                    provider=StandardProviderSettingsDTO(key=key),
                ),
            ),
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
            origin=SecretOrigin.VAULT,
        )
    )


def _adapter(handler) -> StandardComposioMCPAdapter:
    return StandardComposioMCPAdapter(
        api_url="https://broker.composio.test/api/v3.1",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_uses_only_the_project_key_and_project_scoped_session():
    requests: list[httpx.Request] = []
    project_id = uuid4()
    raw_body = b'{ "jsonrpc":"2.0", "id":7, "method":"tools/list" }'

    def broker(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/v3.1/tool_router/session":
            return httpx.Response(
                201,
                json={
                    "mcp": {
                        "url": "https://mcp.composio.test/session/project-a",
                        "headers": {"Authorization": "Bearer session-capability"},
                    }
                },
            )
        assert request.url == "https://mcp.composio.test/session/project-a"
        return httpx.Response(200, content=b'{"jsonrpc":"2.0","id":7,"result":{}}')

    result = await _adapter(broker).relay(
        route=MCPResolvedRoute(url="composio://standard", project_id=project_id),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=raw_body,
        headers={
            "MCP-Protocol-Version": "2025-03-26",
            "X-AG-Credentials": "short-lived-gateway-token",
            "Authorization": "Bearer caller-value",
        },
    )

    assert result.body == b'{"jsonrpc":"2.0","id":7,"result":{}}'
    session_request, mcp_request = requests
    assert session_request.headers["x-api-key"] == "project-composio-key"
    assert "COMPOSIO_API_KEY" not in session_request.headers
    assert json.loads(session_request.content) == {
        "user_id": str(project_id),
        "mcp": True,
    }
    assert mcp_request.content == raw_body
    assert mcp_request.headers["mcp-protocol-version"] == "2025-03-26"
    assert mcp_request.headers["authorization"] == "Bearer session-capability"
    assert "x-ag-credentials" not in mcp_request.headers
    assert "x-api-key" not in mcp_request.headers


@pytest.mark.asyncio
async def test_refuses_before_any_external_request_without_project_key():
    called = False

    def broker(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with pytest.raises(MCPUpstreamError) as excinfo:
        await _adapter(broker).relay(
            route=MCPResolvedRoute(url="composio://standard", project_id=uuid4()),
            auth=MCPDirectAuth(),
            context=MCPCallContext(method="tools/list"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
            headers={},
        )

    assert (
        excinfo.value.detail
        == "standard Composio requires a project-owned provider key"
    )
    assert not called


@pytest.mark.asyncio
async def test_project_sessions_do_not_share_keys_or_composio_user_ids():
    session_requests: list[httpx.Request] = []

    def broker(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v3.1/tool_router/session":
            session_requests.append(request)
            return httpx.Response(
                201,
                json={"mcp": {"url": "https://mcp.composio.test/session"}},
            )
        return httpx.Response(200, content=b"{}")

    adapter = _adapter(broker)
    for key in ("project-a-key", "project-b-key"):
        await adapter.relay(
            route=MCPResolvedRoute(url="composio://standard", project_id=uuid4()),
            auth=_auth(key),
            context=MCPCallContext(method="tools/list"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
            headers={},
        )

    assert [request.headers["x-api-key"] for request in session_requests] == [
        "project-a-key",
        "project-b-key",
    ]
    assert (
        len({json.loads(request.content)["user_id"] for request in session_requests})
        == 2
    )


@pytest.mark.asyncio
async def test_rejects_non_https_capability_url():
    with pytest.raises(MCPUpstreamError) as excinfo:
        await _adapter(
            lambda request: httpx.Response(
                201, json={"mcp": {"url": "http://localhost:9999/mcp"}}
            )
        ).relay(
            route=MCPResolvedRoute(url="composio://standard", project_id=uuid4()),
            auth=_auth(),
            context=MCPCallContext(method="tools/list"),
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
            headers={},
        )
    assert excinfo.value.detail == "session creation returned no valid HTTPS MCP URL"
