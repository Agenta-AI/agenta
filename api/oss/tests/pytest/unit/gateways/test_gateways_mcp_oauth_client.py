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
