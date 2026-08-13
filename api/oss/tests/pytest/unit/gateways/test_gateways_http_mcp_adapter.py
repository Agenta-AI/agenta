"""Unit tests for HttpMcpAdapter (entities.md §7.1, workstreams/specs-wp8.md).

Nothing running: httpx.MockTransport stands in for the upstream — no real network, no
real MCP server. SSRF-guard tests monkeypatch
`oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE` directly rather than the env var
(the same technique `unit/webhooks/test_webhooks_utils.py` uses, since the flag is read
once at import time into that module-level constant) — this is what "set
AGENTA_INSECURE_EGRESS_ALLOWED=false explicitly" means operationally: the guard must be
live, not defaulted off, for every one of these cases.
"""

from types import SimpleNamespace

import httpx
import pytest

from oss.src.core.gateways.mcps.dtos import (
    McpBrokeredAuth,
    McpCallContext,
    McpDirectAuth,
    McpEndpointConfig,
    McpResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMcpAdapter
from oss.src.core.gateways.mcps.providers.http.adapter import HttpMcpAdapter
from oss.src.core.gateways.mcps.types import McpUpstreamError

_PUBLIC_IP = (
    "93.184.216.34"  # example.com — routable, non-private (webhooks test precedent)
)


def _context() -> McpCallContext:
    return McpCallContext(method="tools/list")


def _auth(*, credential=None) -> McpDirectAuth:
    return McpDirectAuth(credential=credential)


def _json_response(status_code: int = 200, **body) -> httpx.Response:
    return httpx.Response(
        status_code, json=body or {"jsonrpc": "2.0", "id": 1, "result": {}}
    )


@pytest.fixture(autouse=True)
def _secure_egress(monkeypatch):
    """Every test in this module runs with the guard live unless a test overrides it —
    AGENTA_INSECURE_EGRESS_ALLOWED=false, set explicitly rather than relied on as a
    default."""
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)


@pytest.fixture(autouse=True)
def _empty_host_allowlist(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.providers.http.adapter.env.mcp_gateway.host_allowlist",
        [],
    )


# ---------------------------------------------------------------------------
# Transparent relay
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_body_passed_through_byte_for_byte():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))
    sent_body = b'{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

    await adapter.relay(
        route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(),
        context=_context(),
        body=sent_body,
        headers={},
    )

    assert captured["content"] == sent_body


@pytest.mark.asyncio
async def test_route_and_caller_headers_both_present():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=McpResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp", headers={"X-Route-Header": "route"}
        ),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={"X-Caller-Header": "caller"},
    )

    assert captured["headers"]["X-Route-Header"] == "route"
    assert captured["headers"]["X-Caller-Header"] == "caller"


@pytest.mark.asyncio
async def test_caller_header_wins_on_collision_with_route_header():
    """route.headers is merged UNDER the caller's forwarded headers (specs-wp8.md §7.1),
    so on a name collision the caller's value is what reaches the upstream. entities.md
    does not mandate this ordering; this test pins the implementation's choice."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=McpResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp", headers={"X-Shared": "route-value"}
        ),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={"X-Shared": "caller-value"},
    )

    assert captured["headers"]["X-Shared"] == "caller-value"


@pytest.mark.asyncio
async def test_upstream_status_and_body_relayed_untouched():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json", "x-upstream": "1"},
            content=b'{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}',
        )

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert isinstance(result, McpRelayResult)
    assert result.status_code == 200
    assert result.body == b'{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}'
    assert result.headers["x-upstream"] == "1"


@pytest.mark.asyncio
async def test_brokered_auth_is_rejected():
    adapter = HttpMcpAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(TypeError):
        await adapter.relay(
            route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=McpBrokeredAuth.model_construct(connection=SimpleNamespace()),
            context=_context(),
            body=b"{}",
            headers={},
        )


# ---------------------------------------------------------------------------
# Authorization derivation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_authorization_header_when_credential_is_none():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(credential=None),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert "authorization" not in captured["headers"]


@pytest.mark.asyncio
async def test_authorization_header_derived_from_oauth_grant():
    """`OAuthGrantSettingsDTO` (entities.md §4.5) isn't in this codebase yet (WP16,
    wave 3), so the mock credential is a SimpleNamespace shaped like its future
    `.secret.data.grant.{access_token,token_type}` — the shape HttpMcpAdapter reads
    defensively via getattr."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))
    mock_credential = SimpleNamespace(
        secret=SimpleNamespace(
            data=SimpleNamespace(
                grant=SimpleNamespace(access_token="tok-abc123", token_type="Bearer")
            )
        )
    )

    await adapter.relay(
        route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=McpDirectAuth.model_construct(credential=mock_credential),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert captured["headers"]["authorization"] == "Bearer tok-abc123"


# ---------------------------------------------------------------------------
# Transport failure vs. protocol-level (pass-through) failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connection_failure_raises_mcp_upstream_error_with_no_false_status():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(McpUpstreamError) as excinfo:
        await adapter.relay(
            route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=_auth(),
            context=_context(),
            body=b"{}",
            headers={},
        )

    assert excinfo.value.target == f"https://{_PUBLIC_IP}/mcp"
    assert excinfo.value.status_code is None


@pytest.mark.asyncio
async def test_jsonrpc_error_body_is_returned_not_raised():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "error": {"code": -32602, "message": "unknown tool"},
            },
        )

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=McpResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert b'"error"' in result.body


# ---------------------------------------------------------------------------
# SSRF guard (D28) — AGENTA_INSECURE_EGRESS_ALLOWED=false via the autouse fixture above
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata, link-local
        "https://127.0.0.1/mcp",  # loopback
        "https://10.0.0.1/mcp",  # RFC-1918 private
    ],
)
async def test_blocked_targets_are_refused(url):
    adapter = HttpMcpAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(McpUpstreamError):
        await adapter.relay(
            route=McpResolvedRoute(url=url),
            auth=_auth(),
            context=_context(),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_plain_http_public_host_is_refused():
    adapter = HttpMcpAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(McpUpstreamError):
        await adapter.relay(
            route=McpResolvedRoute(url=f"http://{_PUBLIC_IP}/mcp"),
            auth=_auth(),
            context=_context(),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_unresolvable_hostname_gives_resolution_message_not_blocked_message(
    monkeypatch,
):
    import socket

    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: (_ for _ in ()).throw(
            socket.gaierror("Name or service not known")
        ),
    )
    adapter = HttpMcpAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(McpUpstreamError) as excinfo:
        await adapter.relay(
            route=McpResolvedRoute(url="https://this-does-not-exist.invalid/mcp"),
            auth=_auth(),
            context=_context(),
            body=b"{}",
            headers={},
        )

    assert "could not be resolved" in (excinfo.value.detail or "")
    assert "blocked" not in (excinfo.value.detail or "")


@pytest.mark.asyncio
async def test_hostname_resolves_to_literal_ip_with_host_header_preserved(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, (_PUBLIC_IP, 0))],
    )
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["host"] = request.url.host
        captured["host_header"] = request.headers["host"]
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=McpResolvedRoute(url="https://mcp.example.com/mcp"),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert captured["host"] == _PUBLIC_IP
    assert captured["host_header"] == "mcp.example.com"


@pytest.mark.asyncio
async def test_host_allowlist_bypasses_the_guard(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.providers.http.adapter.env.mcp_gateway.host_allowlist",
        ["internal-mcp.local"],
    )
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["host"] = request.url.host
        return _json_response()

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=McpResolvedRoute(url="http://internal-mcp.local/mcp"),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert captured["host"] == "internal-mcp.local"


@pytest.mark.asyncio
async def test_endpoint_timeout_config_is_respected(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response()

    real_client_init = httpx.AsyncClient.__init__

    def spy_init(self, *args, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        return real_client_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", spy_init)

    adapter = HttpMcpAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=McpResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp",
            config=McpEndpointConfig(timeout_seconds=5.0),
        ),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert captured["timeout"] == 5.0


# ---------------------------------------------------------------------------
# Namespace scoping: the guard is HttpMcpAdapter's, not McpUpstreamInterface's.
# The `agenta` namespace routes to MockMcpAdapter (WP5), which never makes an
# outbound call at all, so a private-looking route.url on it is never refused.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agenta_route_to_a_private_address_is_not_refused():
    adapter = MockMcpAdapter()

    result = await adapter.relay(
        route=McpResolvedRoute(url="http://127.0.0.1/mcp"),
        auth=_auth(),
        context=McpCallContext(method="tools/list"),
        body=b'{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}',
        headers={},
    )

    assert result.status_code == 200
