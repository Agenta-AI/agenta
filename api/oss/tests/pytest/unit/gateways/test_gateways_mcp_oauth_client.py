"""Unit tests for `MCPOAuthClient`.

`httpx.MockTransport` stands in for a mock authorization server throughout — no real
network, no real authorization server, no real MCP server (matching
`test_gateways_http_mcp_adapter.py`'s and `test_provider_probe.py`'s existing pattern).
"""

from __future__ import annotations

import json

import httpx
import pytest
from mcp.shared.auth import OAuthClientInformationFull

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthTokenExchangeError,
)

_PRM = {
    "resource": "https://mcp.acme.io/",
    "authorization_servers": ["https://auth.acme.io/"],
    "scopes_supported": ["read", "write"],
}
_AS_METADATA = {
    "issuer": "https://auth.acme.io/",
    "authorization_endpoint": "https://auth.acme.io/authorize",
    "token_endpoint": "https://auth.acme.io/token",
    "registration_endpoint": "https://auth.acme.io/register",
    "scopes_supported": ["read", "write"],
}


def _mock_as_handler(*, registration_status=201, token_status=200, token_body=None):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/register":
            return httpx.Response(
                registration_status,
                json={
                    **json.loads(request.content),
                    "client_id": "client-abc",
                    "client_secret": "secret-abc",
                },
            )
        if path == "/token":
            return httpx.Response(
                token_status,
                json=token_body
                or {
                    "access_token": "tok-xyz",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                },
            )
        return httpx.Response(404)

    return handler


@pytest.mark.asyncio
async def test_discover_returns_metadata_from_the_mock_server():
    client = MCPOAuthClient(transport=httpx.MockTransport(_mock_as_handler()))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.resource == "https://mcp.acme.io/"
    assert discovery.authorization_server == "https://auth.acme.io/"
    assert discovery.authorization_endpoint == "https://auth.acme.io/authorize"
    assert discovery.token_endpoint == "https://auth.acme.io/token"
    assert discovery.registration_endpoint == "https://auth.acme.io/register"
    assert set(discovery.scopes_offered) == {"read", "write"}


@pytest.mark.asyncio
async def test_discover_raises_when_every_well_known_url_404s():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(404))
    )

    with pytest.raises(MCPOAuthDiscoveryError):
        await client.discover(server_url="https://mcp.acme.io/")


def _mock_hidden_prm_handler():
    """PRM lives only at `/secret/prm`, named by the 401's `WWW-Authenticate` header.

    Every well-known path 404s. A well-known-only client cannot discover this server;
    that is the OD21 gap this handler exists to prove.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/" and "Authorization" not in request.headers:
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        'Bearer resource_metadata="https://mcp.acme.io/secret/prm"'
                    )
                },
            )
        if path == "/secret/prm":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        return httpx.Response(404)

    return handler


@pytest.mark.asyncio
async def test_discover_reads_resource_metadata_from_the_401_www_authenticate_header():
    """The gap OD21 closes: PRM at an unguessable path, found only via the 401 header."""
    client = MCPOAuthClient(transport=httpx.MockTransport(_mock_hidden_prm_handler()))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.resource == "https://mcp.acme.io/"
    assert discovery.authorization_server == "https://auth.acme.io/"


@pytest.mark.asyncio
async def test_discover_falls_back_to_well_known_when_401_has_no_www_authenticate():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/" and "Authorization" not in request.headers:
            return httpx.Response(401)
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.resource == "https://mcp.acme.io/"


@pytest.mark.asyncio
async def test_discover_falls_back_to_well_known_when_header_has_no_resource_metadata():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/" and "Authorization" not in request.headers:
            return httpx.Response(401, headers={"WWW-Authenticate": "Bearer"})
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.resource == "https://mcp.acme.io/"


@pytest.mark.asyncio
async def test_discover_falls_back_to_well_known_when_header_url_404s():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/" and "Authorization" not in request.headers:
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.acme.io/gone"'
                },
            )
        if path == "/gone":
            return httpx.Response(404)
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.resource == "https://mcp.acme.io/"


@pytest.mark.asyncio
async def test_discover_raises_a_discovery_error_not_a_registration_error_when_header_url_404s_and_no_fallback():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/" and "Authorization" not in request.headers:
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.acme.io/gone"'
                },
            )
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPOAuthDiscoveryError):
        await client.discover(server_url="https://mcp.acme.io/")


@pytest.mark.asyncio
async def test_register_posts_metadata_and_returns_client_info():
    client = MCPOAuthClient(transport=httpx.MockTransport(_mock_as_handler()))

    info = await client.register(
        authorization_server="https://auth.acme.io/",
        registration_endpoint="https://auth.acme.io/register",
        redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
        scopes=["read", "write"],
    )

    assert info.client_id == "client-abc"
    assert info.client_secret == "secret-abc"


@pytest.mark.asyncio
async def test_register_raises_on_non_2xx():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(_mock_as_handler(registration_status=400))
    )

    with pytest.raises(MCPOAuthRegistrationError):
        await client.register(
            authorization_server="https://auth.acme.io/",
            registration_endpoint="https://auth.acme.io/register",
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            scopes=[],
        )


@pytest.mark.asyncio
async def test_exchange_token_returns_the_token_on_success():
    client = MCPOAuthClient(transport=httpx.MockTransport(_mock_as_handler()))
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
        client_secret="secret-abc",
    )

    token = await client.exchange_token(
        token_endpoint="https://auth.acme.io/token",
        code="auth-code-1",
        code_verifier="a" * 43,
        redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
        client_info=client_info,
    )

    assert token.access_token == "tok-xyz"
    assert token.expires_in == 3600


@pytest.mark.asyncio
async def test_exchange_token_raises_on_error_response():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(_mock_as_handler(token_status=400))
    )
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
    )

    with pytest.raises(MCPOAuthTokenExchangeError):
        await client.exchange_token(
            token_endpoint="https://auth.acme.io/token",
            code="bad-code",
            code_verifier="a" * 43,
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            client_info=client_info,
        )


def test_build_pkce_generates_verifier_and_challenge():
    client = MCPOAuthClient()

    pkce = client.build_pkce()

    assert 43 <= len(pkce.code_verifier) <= 128
    assert pkce.code_challenge


def test_authorization_url_carries_the_fixed_redirect_uri_and_pkce():
    client = MCPOAuthClient()

    url = client.authorization_url(
        authorization_endpoint="https://auth.acme.io/authorize",
        client_id="client-abc",
        redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
        code_challenge="challenge-xyz",
        state="state-token",
        scopes=["read", "write"],
        resource="https://mcp.acme.io/",
    )

    assert url.startswith("https://auth.acme.io/authorize?")
    assert "client_id=client-abc" in url
    assert "code_challenge=challenge-xyz" in url
    assert "code_challenge_method=S256" in url
    assert "state=state-token" in url
    assert "scope=read+write" in url
    assert "resource=https%3A%2F%2Fmcp.acme.io%2F" in url


# --- OR42: discovery pins the authorization server it is about to trust --------- #
#
# Every case below publishes metadata the way a hostile or compromised MCP server would,
# and asserts the flow refuses before any credential travels.


def _as_handler(*, prm=None, metadata=None):
    """A server publishing exactly the two documents given."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=prm if prm is not None else _PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200, json=metadata if metadata is not None else _AS_METADATA
            )
        return httpx.Response(404)

    return handler


# The two cases that used to live here asserted the opposite of what follows: that a
# token endpoint or an authorization endpoint on an origin other than the issuer's was
# refused. That rule went beyond RFC 8414 and ruled out an authorization server that
# publishes its issuer on one host and its token endpoint on another, which is Google's
# shape and one MCP deployments meet. The rule that replaces it is where the metadata
# comes FROM, and the three cases below are the same attack asked against that rule.


_SPLIT_PRM = {
    "resource": "https://mcp.acme.io/",
    "authorization_servers": ["https://accounts.example/"],
    "scopes_supported": ["read"],
}
_SPLIT_AS_METADATA = {
    "issuer": "https://accounts.example/",
    "authorization_endpoint": "https://accounts.example/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.example/token",
    "scopes_supported": ["read"],
}


def _host_aware_handler(routes: dict, *, seen: list):
    """A handler keyed by `(host, path)`, so each origin publishes only its own documents.

    The mock handlers above match on path alone, which cannot tell the MCP server's copy
    of a document from the authorization server's. Every case below turns on exactly that
    difference, so every one of them routes by host.

    The host is read from the `Host` header rather than from the URL: the egress boundary
    pins every call to the resolved address and carries the name in that header, so the
    URL's host is the stubbed IP for every origin alike.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.headers.get("Host", request.url.host).split(":")[0]
        seen.append(f"{host}{request.url.path}")
        route = routes.get((host, request.url.path))
        if route is None:
            return httpx.Response(404)
        return httpx.Response(route[0], json=route[1])

    return handler


@pytest.mark.asyncio
async def test_discover_accepts_a_token_endpoint_the_issuer_publishes_on_another_origin():
    """Google's shape: issuer on one host, token endpoint on another.

    `accounts.google.com` publishes `oauth2.googleapis.com/token`. The endpoint is named
    by the issuer's own metadata document, fetched from the issuer's own well-known URL,
    so it is accepted whatever its origin.
    """
    seen: list = []
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _host_aware_handler(
                {
                    ("mcp.acme.io", "/.well-known/oauth-protected-resource"): (
                        200,
                        _SPLIT_PRM,
                    ),
                    (
                        "accounts.example",
                        "/.well-known/oauth-authorization-server",
                    ): (200, _SPLIT_AS_METADATA),
                    ("oauth2.example", "/token"): (
                        200,
                        {
                            "access_token": "tok-split",
                            "token_type": "Bearer",
                            "expires_in": 3600,
                        },
                    ),
                },
                seen=seen,
            )
        )
    )

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.authorization_server == "https://accounts.example/"
    assert (
        discovery.authorization_endpoint == "https://accounts.example/o/oauth2/v2/auth"
    )
    assert discovery.token_endpoint == "https://oauth2.example/token"
    assert "accounts.example/.well-known/oauth-authorization-server" in seen

    # And the flow runs through it: the code is exchanged at the foreign token endpoint.
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
    )
    token = await client.exchange_token(
        token_endpoint=discovery.token_endpoint,
        code="auth-code-1",
        code_verifier="a" * 43,
        redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
        client_info=client_info,
    )

    assert token.access_token == "tok-split"


@pytest.mark.asyncio
async def test_discover_takes_the_endpoints_from_the_issuer_not_from_the_mcp_servers_own_document():
    """The attack OR42 names, asked against the rule that replaces the origin check.

    The MCP server publishes an authorization-server metadata document of its own, at its
    own well-known path, naming a collector it controls as the token endpoint — where the
    authorization code and Agenta's client secret would land. The issuer that the
    protected-resource document names publishes a different token endpoint. Discovery
    never reads the MCP server's copy, so the issuer's endpoint is the one used.
    """
    seen: list = []
    mcp_servers_own_document = {
        "issuer": "https://auth.acme.io/",
        "authorization_endpoint": "https://auth.acme.io/authorize",
        "token_endpoint": "https://collector.evil.io/token",
    }
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _host_aware_handler(
                {
                    ("mcp.acme.io", "/.well-known/oauth-protected-resource"): (
                        200,
                        _PRM,
                    ),
                    ("mcp.acme.io", "/.well-known/oauth-authorization-server"): (
                        200,
                        mcp_servers_own_document,
                    ),
                    ("mcp.acme.io", "/.well-known/openid-configuration"): (
                        200,
                        mcp_servers_own_document,
                    ),
                    ("auth.acme.io", "/.well-known/oauth-authorization-server"): (
                        200,
                        _AS_METADATA,
                    ),
                },
                seen=seen,
            )
        )
    )

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.token_endpoint == "https://auth.acme.io/token"
    assert discovery.token_endpoint != mcp_servers_own_document["token_endpoint"]
    # Nothing was ever asked of the MCP server about the authorization server.
    assert "mcp.acme.io/.well-known/oauth-authorization-server" not in seen
    assert "mcp.acme.io/.well-known/openid-configuration" not in seen


@pytest.mark.asyncio
async def test_discover_refuses_when_the_issuers_metadata_publishes_no_token_endpoint():
    """An endpoint the issuer does not publish is refused, not filled in from elsewhere.

    The MCP server offers a complete document naming its own collector; the issuer's own
    document omits `token_endpoint`. Discovery refuses rather than falling back.
    """
    seen: list = []
    without_token_endpoint = {
        "issuer": "https://auth.acme.io/",
        "authorization_endpoint": "https://auth.acme.io/authorize",
    }
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _host_aware_handler(
                {
                    ("mcp.acme.io", "/.well-known/oauth-protected-resource"): (
                        200,
                        _PRM,
                    ),
                    ("mcp.acme.io", "/.well-known/oauth-authorization-server"): (
                        200,
                        {**_AS_METADATA, "token_endpoint": "https://evil.io/token"},
                    ),
                    ("auth.acme.io", "/.well-known/oauth-authorization-server"): (
                        200,
                        without_token_endpoint,
                    ),
                    ("auth.acme.io", "/.well-known/openid-configuration"): (
                        200,
                        without_token_endpoint,
                    ),
                },
                seen=seen,
            )
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError) as refusal:
        await client.discover(server_url="https://mcp.acme.io/")

    assert "no authorization-server metadata found" in str(refusal.value)


@pytest.mark.asyncio
async def test_discovery_asks_the_issuers_own_well_known_urls_in_rfc_order():
    """RFC 8414 s3.1 inserts the well-known segment before the issuer's path.

    Issuer `https://auth.acme.io/tenant-7` is described at
    `https://auth.acme.io/.well-known/oauth-authorization-server/tenant-7`, not at
    `https://auth.acme.io/tenant-7/.well-known/...`. The OIDC forms (RFC 8414 s5's
    insertion, then OpenID Connect Discovery 1.0 s4.1's appending) follow, and this
    server answers only the last of the three so the whole order is exercised.
    """
    seen: list = []
    tenant_metadata = {
        "issuer": "https://auth.acme.io/tenant-7",
        "authorization_endpoint": "https://auth.acme.io/tenant-7/authorize",
        "token_endpoint": "https://tokens.acme.io/tenant-7/token",
    }
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _host_aware_handler(
                {
                    ("mcp.acme.io", "/.well-known/oauth-protected-resource"): (
                        200,
                        {
                            **_PRM,
                            "authorization_servers": ["https://auth.acme.io/tenant-7"],
                        },
                    ),
                    ("auth.acme.io", "/tenant-7/.well-known/openid-configuration"): (
                        200,
                        tenant_metadata,
                    ),
                },
                seen=seen,
            )
        )
    )

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.token_endpoint == "https://tokens.acme.io/tenant-7/token"
    assert seen[-3:] == [
        "auth.acme.io/.well-known/oauth-authorization-server/tenant-7",
        "auth.acme.io/.well-known/openid-configuration/tenant-7",
        "auth.acme.io/tenant-7/.well-known/openid-configuration",
    ]


@pytest.mark.asyncio
async def test_discover_refuses_metadata_whose_issuer_is_not_the_requested_server():
    """RFC 8414 s3.3: the document must claim the issuer whose well-known URL served it."""
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _as_handler(
                metadata={**_AS_METADATA, "issuer": "https://elsewhere.acme.io/"}
            )
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError) as refusal:
        await client.discover(server_url="https://mcp.acme.io/")

    assert "issuer" in str(refusal.value)


@pytest.mark.asyncio
async def test_discover_refuses_protected_resource_metadata_describing_another_resource():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _as_handler(prm={**_PRM, "resource": "https://other.acme.io/"})
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError) as refusal:
        await client.discover(server_url="https://mcp.acme.io/")

    assert "different resource" in str(refusal.value)


@pytest.mark.asyncio
async def test_discover_refuses_a_plain_http_authorization_endpoint(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.oauth.client.env.gateway_egress.insecure_allowed",
        False,
    )
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _as_handler(
                metadata={
                    **_AS_METADATA,
                    "authorization_endpoint": "http://auth.acme.io/authorize",
                }
            )
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError) as refusal:
        await client.discover(server_url="https://mcp.acme.io/")

    assert "not https" in str(refusal.value)


@pytest.mark.asyncio
async def test_discover_refuses_a_plain_http_authorization_server(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.oauth.client.env.gateway_egress.insecure_allowed",
        False,
    )
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _as_handler(prm={**_PRM, "authorization_servers": ["http://auth.acme.io/"]})
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError) as refusal:
        await client.discover(server_url="https://mcp.acme.io/")

    assert "not https" in str(refusal.value)


@pytest.mark.asyncio
async def test_discover_allows_plain_http_when_the_operator_turned_the_guard_off(
    monkeypatch,
):
    """One switch, not two: the deployment that turned off the egress guard turned off
    the https requirement with it."""
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.oauth.client.env.gateway_egress.insecure_allowed",
        True,
    )
    plain = {
        "issuer": "http://auth.acme.io/",
        "authorization_endpoint": "http://auth.acme.io/authorize",
        "token_endpoint": "http://auth.acme.io/token",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(
                200, json={**_PRM, "authorization_servers": ["http://auth.acme.io/"]}
            )
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=plain)
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.token_endpoint == "http://auth.acme.io/token"


@pytest.mark.asyncio
async def test_discover_refuses_protected_resource_metadata_naming_no_authorization_server():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _as_handler(prm={**_PRM, "authorization_servers": []})
        )
    )

    with pytest.raises(MCPOAuthDiscoveryError):
        await client.discover(server_url="https://mcp.acme.io/")


_UPSTREAM_BODY = "the-upstream-said-this-and-it-must-not-come-back"


@pytest.mark.asyncio
async def test_registration_failure_does_not_echo_the_upstream_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text=_UPSTREAM_BODY)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    with pytest.raises(MCPOAuthRegistrationError) as refusal:
        await client.register(
            authorization_server="https://auth.acme.io/",
            registration_endpoint="https://auth.acme.io/register",
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            scopes=[],
        )

    message = str(refusal.value)
    assert _UPSTREAM_BODY not in message
    # An operator still learns what refused, and how. The origin is compared as the exact
    # rendered fragment rather than a bare host substring.
    assert "400" in message
    assert "from https://auth.acme.io" in message


@pytest.mark.asyncio
async def test_token_exchange_failure_does_not_echo_the_upstream_body():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(400, text=_UPSTREAM_BODY)
        )
    )
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
    )

    with pytest.raises(MCPOAuthTokenExchangeError) as refusal:
        await client.exchange_token(
            token_endpoint="https://auth.acme.io/token",
            code="bad-code",
            code_verifier="a" * 43,
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            client_info=client_info,
        )

    message = str(refusal.value)
    assert _UPSTREAM_BODY not in message
    assert "400" in message


@pytest.mark.asyncio
async def test_a_malformed_token_response_does_not_echo_the_upstream_body():
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"nonsense": _UPSTREAM_BODY})
        )
    )
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
    )

    with pytest.raises(MCPOAuthTokenExchangeError) as refusal:
        await client.exchange_token(
            token_endpoint="https://auth.acme.io/token",
            code="a-code",
            code_verifier="a" * 43,
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            client_info=client_info,
        )

    assert _UPSTREAM_BODY not in str(refusal.value)


# --- OR55: the refresh grant ---------------------------------------------------- #


@pytest.mark.asyncio
async def test_refresh_token_posts_the_refresh_grant_and_returns_the_new_token():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(
            dict(
                pair.split("=", 1)
                for pair in request.content.decode().split("&")
                if "=" in pair
            )
        )
        return httpx.Response(
            200,
            json={
                "access_token": "tok-renewed",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))
    client_info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-abc",
    )

    token = await client.refresh_token(
        token_endpoint="https://auth.acme.io/token",
        refresh_token="refresh-1",
        client_info=client_info,
    )

    assert token.access_token == "tok-renewed"
    assert seen["grant_type"] == "refresh_token"
    assert seen["refresh_token"] == "refresh-1"
