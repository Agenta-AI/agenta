"""Unit tests for HttpMCPAdapter (entities.md §7.1, workstreams/specs-wp8.md).

Nothing running: httpx.MockTransport stands in for the upstream — no real network, no
real MCP server. SSRF-guard tests monkeypatch
`oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE` directly rather than the env var
(the same technique `unit/webhooks/test_webhooks_utils.py` uses, since the flag is read
once at import time into that module-level constant) — this is what "set
AGENTA_INSECURE_EGRESS_ALLOWED=false explicitly" means operationally: the guard must be
live, not defaulted off, for every one of these cases.
"""

import json
from types import SimpleNamespace

import httpx
import pytest

from oss.src.core.gateways.dtos import CREDENTIAL_ECHO_CODE
from oss.src.core.gateways.mcps.echo import MCPUpstreamCredentialEchoError
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
def _no_exempt_hosts(monkeypatch):
    """No address is exempt from the guard while these cases run.

    `exempt_hosts` has two sources and both are operator environment: the MCP host
    allowlist, and — while the mocks flag is on — the hosts of the two mock gateway URLs.
    A developer who exports the documented host-side values, which point at loopback,
    turned every loopback-refusal case here green for the wrong reason, because the
    address under test had become exempt (D47).

    Cleared rather than asserted, so these cases mean the same thing whatever the shell
    they are run from holds. The exemption itself is covered where it belongs, beside
    `exempt_hosts`.
    """
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist", []
    )
    monkeypatch.setattr("oss.src.core.gateways.egress.env.mock_gateways.enabled", False)


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
async def test_route_headers_and_allowlisted_caller_headers_both_present():
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
        headers={"MCP-Protocol-Version": "2026-07-28", "X-Caller-Header": "caller"},
    )

    assert captured["headers"]["X-Route-Header"] == "route"
    # OR36: the caller's headers are an allowlist, not a pass-through. A protocol header
    # the upstream needs travels; an arbitrary one the caller invented does not.
    assert captured["headers"]["MCP-Protocol-Version"] == "2026-07-28"
    assert "x-caller-header" not in captured["headers"]


@pytest.mark.asyncio
async def test_caller_header_wins_on_collision_with_route_header():
    """route.headers is merged UNDER the caller's forwarded headers (specs-wp8.md §7.1),
    so on a name collision the caller's value is what reaches the upstream. entities.md
    does not mandate this ordering; this test pins the implementation's choice.

    The collision is on a forwardable name, because since OR36 a name outside the allowlist
    never reaches the merge at all. The caller's spelling is the lowercase one Starlette
    produces, so the merge has to be case-insensitive for its value to win."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp",
            headers={"MCP-Protocol-Version": "route-value"},
        ),
        auth=_auth(),
        context=_context(),
        body=b"{}",
        headers={"mcp-protocol-version": "caller-value"},
    )

    assert captured["headers"].get_list("mcp-protocol-version") == ["caller-value"]


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
# SSRF guard; the autouse fixture disables insecure egress.
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
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist",
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
# The `agenta` namespace routes to MockMCPAdapter, which never makes an
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
        # Post-handshake requests carry the version initialize negotiated; the mock is strict
        # about it, the way a real server is. This case is about egress, not the handshake.
        headers={"mcp-protocol-version": "2026-07-28"},
    )

    assert result.status_code == 200


# ---------------------------------------------------------------------------
# Gateway-only headers never reach a third-party server.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_our_credentials_header_is_never_forwarded_upstream():
    """The caller's headers are forwarded wholesale except this one: it authenticates
    the caller INTO the gateway and is ours, not the upstream's (D31)."""
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
        headers={"X-AG-Credentials": "Secret leaked-token"},
    )

    assert "x-ag-credentials" not in captured["headers"]


@pytest.mark.asyncio
async def test_endpoint_without_a_secret_still_calls_the_server_unauthenticated():
    """OR36: an endpoint's credential comes from its registered secret, never from the
    caller. An endpoint registered without one is an unauthenticated upstream by design, so
    the call still goes out and the server answers it as it sees fit — but the caller's own
    `Authorization` is not what carries it there."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_auth(secret=None),
        context=_context(),
        body=b"{}",
        headers={"authorization": "Bearer caller-token"},
    )

    assert result.status_code == 200
    assert "authorization" not in captured["headers"]


# ---------------------------------------------------------------------------
# API-key credential binding (OR54)
#
# An MCP server names the header it wants its key in, and the agent config already says
# so (`credentials.header_secret_refs`). The endpoint carries that name on its route and
# the key itself only as an opaque `secret_id`, so these cases pin what the relay puts on
# the wire for each vault shape a bound secret can have.
# ---------------------------------------------------------------------------

_SYNTHETIC_API_KEY = "synthetic-mcp-api-key-0123456789"  # gitleaks:allow


def _named_secret_auth(content):
    """An `MCPDirectAuth` over a project-named secret (`custom_secret`), the kind the
    agent config's `header_secret_refs` picks."""
    return MCPDirectAuth.model_construct(
        secret=SimpleNamespace(
            secret=SimpleNamespace(
                data=SimpleNamespace(secret=SimpleNamespace(content=content))
            )
        )
    )


def _provider_key_auth(key):
    """An `MCPDirectAuth` over a provider-key record, which keeps its value elsewhere."""
    return MCPDirectAuth.model_construct(
        secret=SimpleNamespace(
            secret=SimpleNamespace(
                data=SimpleNamespace(provider=SimpleNamespace(key=key))
            )
        )
    )


@pytest.mark.asyncio
async def test_api_key_travels_in_the_header_the_endpoint_registered():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp", credential_header="x-api-key"
        ),
        auth=_named_secret_auth(_SYNTHETIC_API_KEY),
        context=_context(),
        body=b"{}",
        headers={},
    )

    # Verbatim, with no scheme prefix: this is the request the SDK sends when it dials the
    # same server without a gateway (`agenta/sdk/agents/mcp/resolver.py`).
    assert captured["headers"]["x-api-key"] == _SYNTHETIC_API_KEY
    assert "authorization" not in captured["headers"]


@pytest.mark.asyncio
async def test_api_key_without_a_registered_header_falls_back_to_bearer():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_provider_key_auth(_SYNTHETIC_API_KEY),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert captured["headers"]["authorization"] == f"Bearer {_SYNTHETIC_API_KEY}"


@pytest.mark.asyncio
async def test_json_named_secret_carries_no_single_key_so_nothing_is_sent():
    """A JSON-format named secret is a map, not one credential. Picking an entry out of it
    would be a guess, so the relay sends nothing rather than the wrong value."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return _json_response()

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    await adapter.relay(
        route=MCPResolvedRoute(
            url=f"https://{_PUBLIC_IP}/mcp", credential_header="x-api-key"
        ),
        auth=_named_secret_auth({"token": _SYNTHETIC_API_KEY}),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert "x-api-key" not in captured["headers"]
    assert "authorization" not in captured["headers"]


# ---------------------------------------------------------------------------
# Injected-credential echo (OR75)
#
# The relay reads the whole response before it returns, so detection is enough and
# nothing needs withholding. Both surfaces are covered: the body, and the response's own
# header block, which the proxy copies onto Agenta's response.
# ---------------------------------------------------------------------------

_SYNTHETIC_GRANT = "synthetic-mcp-grant-0123456789"


def _grant_auth(access_token):
    return MCPDirectAuth.model_construct(
        secret=SimpleNamespace(
            secret=SimpleNamespace(
                data=SimpleNamespace(
                    grant=SimpleNamespace(
                        access_token=access_token, token_type="Bearer"
                    )
                )
            )
        )
    )


@pytest.mark.asyncio
async def test_upstream_echoing_the_grant_in_its_body_is_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "error": {
                    "code": -32000,
                    "message": f"rejected Authorization: Bearer {_SYNTHETIC_GRANT}",
                },
            },
        )

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamCredentialEchoError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=_grant_auth(_SYNTHETIC_GRANT),
            context=_context(),
            body=b"{}",
            headers={},
        )

    envelope = excinfo.value.envelope
    assert envelope["code"] == CREDENTIAL_ECHO_CODE
    assert envelope["retryable"] is False
    # The refusal reaches the sandbox and the transcript, which is the disclosure it
    # exists to prevent.
    assert _SYNTHETIC_GRANT not in json.dumps(envelope)
    assert _SYNTHETIC_GRANT not in str(excinfo.value)


@pytest.mark.asyncio
async def test_upstream_echoing_the_grant_in_a_response_header_is_refused():
    """A 200 whose body is clean still discloses the credential when a debug header holds
    it, because the proxy copies the upstream's headers onto Agenta's own response."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"x-debug-auth": f"Bearer {_SYNTHETIC_GRANT}"},
            content=b'{"jsonrpc":"2.0","id":1,"result":{}}',
        )

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamCredentialEchoError):
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=_grant_auth(_SYNTHETIC_GRANT),
            context=_context(),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_upstream_echoing_an_api_key_from_a_named_header_is_refused():
    """The scan follows the value, not the header name: an endpoint's key travels in a
    name the endpoint chose, which the LLM plane's fixed list of credential headers would
    never have recognised."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=f'{{"jsonrpc":"2.0","id":1,"result":{{"sent":"{_SYNTHETIC_API_KEY}"}}}}'.encode(),
        )

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamCredentialEchoError):
        await adapter.relay(
            route=MCPResolvedRoute(
                url=f"https://{_PUBLIC_IP}/mcp", credential_header="x-exa-api-key"
            ),
            auth=_named_secret_auth(_SYNTHETIC_API_KEY),
            context=_context(),
            body=b"{}",
            headers={},
        )


@pytest.mark.asyncio
async def test_response_that_merely_resembles_the_credential_is_relayed():
    """The refusal is for the value itself. A body carrying a prefix of it, or an endpoint
    with no credential at all, must not cost the caller its response."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=f'{{"echo":"{_SYNTHETIC_GRANT[:-1]}"}}'.encode(),
        )

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    result = await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_grant_auth(_SYNTHETIC_GRANT),
        context=_context(),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 200
    assert _SYNTHETIC_GRANT.encode()[:-1] in result.body


# ---------------------------------------------------------------------------
# OR86: a transport failure must not quote the request it failed to send
# ---------------------------------------------------------------------------

# What h11 actually produces when it refuses the header the relay built. Reproduced
# against a real socket in `reviews/repro_header_leak2.py`: a stored credential with a
# trailing newline arrives here verbatim, inside `httpx.LocalProtocolError`, which is a
# subclass of `httpx.RequestError` and so was caught and copied onto the caller's field.
_LEAKY_TOKEN = "ag-secret-value-DO-NOT-LEAK"
_H11_REFUSAL = f"Illegal header value b'Bearer {_LEAKY_TOKEN}\\n'"


def _oauth_secret(token: str):
    return SimpleNamespace(
        secret=SimpleNamespace(
            data=SimpleNamespace(
                grant=SimpleNamespace(access_token=token, token_type="Bearer")
            )
        )
    )


@pytest.mark.asyncio
async def test_a_refused_request_does_not_return_the_credential_it_was_carrying():
    """The P0 of review round 1. The relay caught h11's refusal and handed its text —
    which quotes the header bytes, credential included — back to the caller as the
    JSON-RPC error message."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.LocalProtocolError(_H11_REFUSAL)

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=MCPDirectAuth.model_construct(
                secret=_oauth_secret(f"{_LEAKY_TOKEN}\n")
            ),
            context=_context(),
            body=b"{}",
            headers={},
        )

    error = excinfo.value
    assert _LEAKY_TOKEN not in (error.detail or "")
    assert _LEAKY_TOKEN not in error.message
    assert _LEAKY_TOKEN not in str(error)
    # And it still says something a person can act on.
    assert "stray characters" in (error.detail or "")


@pytest.mark.asyncio
async def test_the_refusal_reaches_the_caller_through_the_proxy_with_no_credential():
    """The adapter is not the boundary a caller reads. This drives the real proxy mapper
    over the real exception, which is where the value actually escaped."""
    from oss.src.apis.fastapi.gateways.mcps.proxy import _map_gateway_exception

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.LocalProtocolError(_H11_REFUSAL)

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
            auth=MCPDirectAuth.model_construct(
                secret=_oauth_secret(f"{_LEAKY_TOKEN}\n")
            ),
            context=_context(),
            body=b"{}",
            headers={},
        )

    rendered = _map_gateway_exception(excinfo.value).body.decode()

    assert _LEAKY_TOKEN not in rendered
    assert json.loads(rendered)["error"]["data"]["cause"] == "upstream_error"


@pytest.mark.asyncio
async def test_an_ordinary_transport_failure_still_says_which_kind_it_was():
    """Classifying must not flatten every failure into one sentence: an operator reading
    a refusal has to be able to tell a timeout from an unreachable host."""
    seen = {}

    for raised, expected in (
        (httpx.ConnectTimeout("timed out"), "did not answer in time"),
        (httpx.ConnectError("connection refused"), "could not be reached"),
    ):

        def handler(request: httpx.Request, exc=raised) -> httpx.Response:
            raise exc

        adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))
        with pytest.raises(MCPUpstreamError) as excinfo:
            await adapter.relay(
                route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
                auth=_auth(),
                context=_context(),
                body=b"{}",
                headers={},
            )
        seen[expected] = excinfo.value.detail

    for expected, detail in seen.items():
        assert expected in (detail or "")
    assert len(set(seen.values())) == 2
