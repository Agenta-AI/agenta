"""Unit tests for HttpMCPAdapter (entities.md §7.1, workstreams/specs-wp8.md).

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
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPEndpointSettings,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
from oss.src.core.gateways.mcps.providers.http.adapter import HttpMCPAdapter
from oss.src.core.gateways.mcps.types import MCPUpstreamError

_PUBLIC_IP = (
    "93.184.216.34"  # example.com — routable, non-private (webhooks test precedent)
)


def _context() -> MCPCallContext:
    return MCPCallContext(method="tools/list")


def _auth(*, secret=None) -> MCPDirectAuth:
    return MCPDirectAuth(secret=secret)


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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))
    sent_body = b'{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert isinstance(result, MCPRelayResult)
    assert result.status_code == 200
    assert result.body == b'{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}'
    assert result.headers["x-upstream"] == "1"


@pytest.mark.asyncio
async def test_brokered_auth_is_rejected():
    adapter = HttpMCPAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(TypeError):
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=MCPBrokeredAuth.model_construct(connection=SimpleNamespace()),
            context=_context(),
            body=b"{}",
            headers={},
        )


# ---------------------------------------------------------------------------
# Authorization derivation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_authorization_header_when_secret_is_none():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(secret=None),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert "authorization" not in captured["headers"]


@pytest.mark.asyncio
async def test_authorization_header_derived_from_oauth_grant():
    """`OAuthGrantSettingsDTO` (entities.md §4.5) isn't in this codebase yet (WP16,
    wave 3), so the mock secret is a SimpleNamespace shaped like its future
    `.secret.data.grant.{access_token,token_type}` — the shape HttpMCPAdapter reads
    defensively via getattr."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))
    mock_secret = SimpleNamespace(
        secret=SimpleNamespace(
            data=SimpleNamespace(
                grant=SimpleNamespace(access_token="tok-abc123", token_type="Bearer")
            )
        )
    )

    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=MCPDirectAuth.model_construct(secret=mock_secret),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
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
    adapter = HttpMCPAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(MCPUpstreamError):
        await adapter.relay(
            route=MCPResolvedRoute(url=url),
            auth=_auth(),
            context=_context(),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_plain_http_public_host_is_refused():
    adapter = HttpMCPAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(MCPUpstreamError):
        await adapter.relay(
            route=MCPResolvedRoute(url=f"http://{_PUBLIC_IP}/mcp"),
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
    adapter = HttpMCPAdapter(transport=httpx.MockTransport(lambda r: _json_response()))

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url="https://this-does-not-exist.invalid/mcp"),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(url="https://mcp.example.com/mcp"),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=MCPResolvedRoute(url="http://internal-mcp.local/mcp"),
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

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp",
            settings=MCPEndpointSettings(timeout_seconds=5.0),
        ),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert captured["timeout"] == 5.0


# ---------------------------------------------------------------------------
# Namespace scoping: the guard is HttpMCPAdapter's, not MCPUpstreamInterface's.
# The `agenta` namespace routes to MockMCPAdapter (WP5), which never makes an
# outbound call at all, so a private-looking route.url on it is never refused.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agenta_route_to_a_private_address_is_not_refused():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=MCPResolvedRoute(url="http://127.0.0.1/mcp"),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=b'{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}',
        headers={},
    )

    assert result.status_code == 200


# ---------------------------------------------------------------------------
# Gateway-only headers never reach a third-party server (D31)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("header", ["X-AG-Credentials", "Authorization"])
async def test_gateway_credentials_are_never_forwarded_upstream(header):
    """The caller's headers are forwarded wholesale except these: they authenticate
    the caller INTO the gateway and are ours, not the upstream's."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(secret=None),
        context=_context(),
        body=b"{}",
        headers={header: "Secret leaked-token"},
    )

    assert header.lower() not in captured["headers"]
