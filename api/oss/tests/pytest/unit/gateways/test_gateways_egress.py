"""Request-time egress regressions for both gateway planes (OD26, closing OR40 and OR64).

Registration validates a URL's format and its literal IP and defers name resolution to the
point of use (`core/webhooks/utils.py::validate_url_format_and_literal_ip`). Until this
module's subject existed, two of the three outbound paths never performed that deferred
check: the LLM relay dialled the stored hostname, and the MCP OAuth client fetched metadata,
registration and token URLs unguarded — including a `resource_metadata` location the
upstream itself supplies in a `WWW-Authenticate` challenge, which reached
`http://169.254.169.254/latest/meta-data/`. Every case here fails against that code and
passes against `core/gateways/egress.py`.

Nothing running: `httpx.MockTransport` intercepts every request and the resolver is stubbed
(`conftest.py`), so no DNS query and no socket. The guard is live in all of them without any
fixture arranging it: the gateway owns `AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED` and it
defaults to enforcing, which the last three cases assert directly so nobody can quietly
relax it. Webhook delivery keeps its own permissive default, and the gateway no longer reads
it.
"""

import json
from typing import List, Optional

import httpx
import pytest

from oss.src.core.gateways.egress import EgressRefusedError, open_egress
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpointSettings,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import RelayLLMAdapter
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthTokenExchangeError,
)
from oss.src.core.gateways.mcps.providers.http.adapter import HttpMCPAdapter
from oss.src.core.gateways.mcps.types import MCPUpstreamError

from oss.tests.pytest.unit.gateways.conftest import (
    LINK_LOCAL_ADDRESS,
    LOOPBACK_ADDRESS,
    PRIVATE_ADDRESS,
    PUBLIC_ADDRESS,
)

# The hostname a tenant registered. It passed registration because it is not a literal IP;
# what it resolves to is decided at call time, by whoever controls the zone.
_REGISTERED_HOST = "upstream.example"

_BLOCKED_ADDRESSES = [LOOPBACK_ADDRESS, LINK_LOCAL_ADDRESS, PRIVATE_ADDRESS]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _llm_route(base_url: str = f"https://{_REGISTERED_HOST}/v1") -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        model="gpt-4o",
        base_url=base_url,
        settings=LLMEndpointSettings(),
    )


def _llm_adapter(handler) -> RelayLLMAdapter:
    return RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


def _llm_body() -> bytes:
    return json.dumps(
        {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}
    ).encode()


async def _relay_llm(adapter: RelayLLMAdapter, *, base_url: Optional[str] = None):
    route = _llm_route(base_url) if base_url else _llm_route()
    return await adapter.relay_chat_completion(
        route=route,
        secret=None,
        context=LLMCallContext(model="gpt-4o"),
        body=_llm_body(),
        headers={},
    )


def _recording_handler(seen: List[httpx.Request], response: httpx.Response = None):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return response or httpx.Response(200, json={"id": "x", "choices": []})

    return handler


# ---------------------------------------------------------------------------
# OR40, LLM plane: the deferred check now runs, on every resolved address
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("address", _BLOCKED_ADDRESSES)
async def test_llm_relay_refuses_a_registered_hostname_that_resolves_internally(
    resolves_to, address
):
    """Registration accepted the hostname; the call must not accept the address."""
    resolves_to(address)
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    with pytest.raises(LLMUpstreamError) as excinfo:
        await _relay_llm(adapter)

    assert "blocked target" in (excinfo.value.detail or "")
    assert seen == []


@pytest.mark.asyncio
async def test_llm_relay_refuses_a_host_where_only_one_resolved_address_is_private(
    resolves_to,
):
    """A zone that answers with a public address first and a private one second is the
    whole attack: checking only the first address admits it."""
    resolves_to(PUBLIC_ADDRESS, PRIVATE_ADDRESS)
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    with pytest.raises(LLMUpstreamError):
        await _relay_llm(adapter)

    assert seen == []


@pytest.mark.asyncio
async def test_llm_relay_pins_to_the_checked_address(monkeypatch):
    """A name that resolves public, then private, still reaches the checked address.

    The guard and the connect are two separate resolutions unless the request is pinned, and
    a zone with a one-second TTL controls what happens between them.
    """
    answers = iter(
        [
            [(None, None, None, None, (PUBLIC_ADDRESS, 0))],
            [(None, None, None, None, (PRIVATE_ADDRESS, 0))],
        ]
    )
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *_args, **_kwargs: next(answers),
    )
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    await _relay_llm(adapter)

    assert len(seen) == 1
    # The connection went to the literal address the guard checked, not to the name.
    assert seen[0].url.host == PUBLIC_ADDRESS
    # The registered authority still travels, so the upstream routes and TLS verifies.
    assert seen[0].headers["host"] == _REGISTERED_HOST
    assert seen[0].extensions["sni_hostname"] == _REGISTERED_HOST


@pytest.mark.asyncio
async def test_llm_relay_does_not_follow_a_redirect(resolves_to):
    """A 302 is the upstream re-pointing the request at a host nothing checked."""
    resolves_to(PUBLIC_ADDRESS)
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(
        _recording_handler(
            seen,
            httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"}),
        )
    )

    result = await _relay_llm(adapter)

    assert result.status_code == 302
    assert len(seen) == 1
    assert seen[0].url.host == PUBLIC_ADDRESS


# ---------------------------------------------------------------------------
# OR40, MCP OAuth: every call the client makes, discovery included
# ---------------------------------------------------------------------------

_PRM = {
    "resource": "https://mcp.acme.io/",
    "authorization_servers": ["https://auth.acme.io/"],
}


def _oauth_client(seen: List[httpx.Request]) -> MCPOAuthClient:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        return httpx.Response(404)

    return MCPOAuthClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_oauth_discovery_never_dials_a_resource_metadata_url_the_upstream_supplied(
    monkeypatch,
):
    """RFC 9728 lets the upstream name its own metadata location in `WWW-Authenticate`.
    That location is attacker-chosen, and before OD26 it was fetched unguarded — this is
    the exact path that reached `http://169.254.169.254/latest/meta-data/`."""
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *_args, **_kwargs: [(None, None, None, None, (PUBLIC_ADDRESS, 0))],
    )
    metadata_url = "http://169.254.169.254/latest/meta-data/"
    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/":
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": f'Bearer resource_metadata="{metadata_url}"'
                },
            )
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": "https://auth.acme.io/",
                    "authorization_endpoint": "https://auth.acme.io/authorize",
                    "token_endpoint": "https://auth.acme.io/token",
                },
            )
        return httpx.Response(404)

    client = MCPOAuthClient(transport=httpx.MockTransport(handler))

    discovery = await client.discover(server_url="https://mcp.acme.io/")

    assert discovery.token_endpoint == "https://auth.acme.io/token"
    assert LINK_LOCAL_ADDRESS not in {request.url.host for request in seen}


@pytest.mark.asyncio
@pytest.mark.parametrize("address", _BLOCKED_ADDRESSES)
async def test_oauth_discovery_refuses_a_server_url_that_resolves_internally(
    resolves_to, address
):
    resolves_to(address)
    seen: List[httpx.Request] = []
    client = _oauth_client(seen)

    with pytest.raises(MCPOAuthDiscoveryError):
        await client.discover(server_url="https://mcp.acme.io/")

    assert seen == []


@pytest.mark.asyncio
@pytest.mark.parametrize("address", _BLOCKED_ADDRESSES)
async def test_oauth_registration_refuses_an_endpoint_that_resolves_internally(
    resolves_to, address
):
    resolves_to(address)
    seen: List[httpx.Request] = []
    client = _oauth_client(seen)

    with pytest.raises(MCPOAuthRegistrationError):
        await client.register(
            authorization_server="https://auth.acme.io/",
            registration_endpoint="https://auth.acme.io/register",
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            scopes=["read"],
        )

    assert seen == []


@pytest.mark.asyncio
@pytest.mark.parametrize("address", _BLOCKED_ADDRESSES)
async def test_oauth_token_exchange_refuses_an_endpoint_that_resolves_internally(
    resolves_to, address
):
    from mcp.shared.auth import OAuthClientInformationFull

    resolves_to(address)
    seen: List[httpx.Request] = []
    client = _oauth_client(seen)

    with pytest.raises(MCPOAuthTokenExchangeError):
        await client.exchange_token(
            token_endpoint="https://auth.acme.io/token",
            code="code-abc",
            code_verifier="verifier-abc",
            redirect_uri="https://api.agenta.ai/gateways/mcps/connect/callback",
            client_info=OAuthClientInformationFull(
                client_id="client-abc",
                redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
            ),
        )

    assert seen == []


# ---------------------------------------------------------------------------
# MCP relay: the plane that already resolved and pinned keeps doing so, through
# the shared module rather than its own copy (OR64)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mcp_relay_does_not_follow_a_redirect(resolves_to):
    resolves_to(PUBLIC_ADDRESS)
    seen: List[httpx.Request] = []
    adapter = HttpMCPAdapter(
        transport=httpx.MockTransport(
            _recording_handler(
                seen,
                httpx.Response(
                    302, headers={"location": "http://169.254.169.254/latest/"}
                ),
            )
        )
    )

    result = await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_REGISTERED_HOST}/mcp"),
        auth=MCPDirectAuth(secret=None),
        context=MCPCallContext(method="tools/list"),
        body=b"{}",
        headers={},
    )

    assert result.status_code == 302
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_mcp_relay_refuses_a_host_where_only_one_resolved_address_is_private(
    resolves_to,
):
    resolves_to(PUBLIC_ADDRESS, LINK_LOCAL_ADDRESS)
    seen: List[httpx.Request] = []
    adapter = HttpMCPAdapter(transport=httpx.MockTransport(_recording_handler(seen)))

    with pytest.raises(MCPUpstreamError):
        await adapter.relay(
            route=MCPResolvedRoute(url=f"https://{_REGISTERED_HOST}/mcp"),
            auth=MCPDirectAuth(secret=None),
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
        )

    assert seen == []


# ---------------------------------------------------------------------------
# The module itself
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_open_egress_strips_the_callers_credential_headers(resolves_to):
    """The header allowlist lives in `core/gateways/dtos.py` and is not restated here;
    this asserts every call site inherits it by construction."""
    resolves_to(PUBLIC_ADDRESS)

    target = await open_egress(
        f"https://{_REGISTERED_HOST}/v1",
        caller_headers={
            "Authorization": "Bearer caller-session",
            "Cookie": "agenta_session=abc",
            "X-AG-Credentials": "ApiKey abc",
            "Accept": "application/json",
        },
    )

    assert "authorization" not in target.headers
    assert "cookie" not in target.headers
    assert "x-ag-credentials" not in target.headers
    assert target.headers["accept"] == "application/json"


@pytest.mark.asyncio
async def test_open_egress_refuses_plain_http_while_the_guard_is_live(resolves_to):
    resolves_to(PUBLIC_ADDRESS)

    with pytest.raises(EgressRefusedError):
        await open_egress(f"http://{_REGISTERED_HOST}/v1")


@pytest.mark.asyncio
async def test_open_egress_separates_an_unresolvable_name_from_a_refusal(monkeypatch):
    """A DNS typo is a user error and a blocked address is a security refusal; the two
    must not arrive at the caller wearing the same words."""
    import socket

    def _nxdomain(*_args, **_kwargs):
        raise socket.gaierror("nope")

    monkeypatch.setattr("oss.src.core.webhooks.utils.socket.getaddrinfo", _nxdomain)

    with pytest.raises(EgressRefusedError) as excinfo:
        await open_egress(f"https://{_REGISTERED_HOST}/v1")

    assert excinfo.value.unresolvable
    assert "blocked target" not in excinfo.value.relay_detail


# ---------------------------------------------------------------------------
# The gate itself: enforcing by default, and not the webhooks one
# ---------------------------------------------------------------------------


def test_gateway_egress_guard_is_enforcing_by_default():
    """A check that is off by default is not a check.

    `AGENTA_INSECURE_EGRESS_ALLOWED` defaults to permissive so a zero-config self-host can
    post a webhook to a box on its own LAN. The gateway does not inherit that answer. This
    reads the declared default off the config class rather than a module constant some
    fixture pinned, so relaxing it in `utils/env.py` fails here. (It also fails if the test
    process itself exports the opt-out, which is the honest answer: the guard would not be
    enforcing in that process either.)
    """
    import os

    from oss.src.utils.env import GatewayEgressConfig

    assert os.getenv("AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED") is None
    assert GatewayEgressConfig.model_fields["insecure_allowed"].default is False
    assert GatewayEgressConfig().insecure_allowed is False


@pytest.mark.asyncio
async def test_gateway_egress_refuses_even_where_webhooks_are_permissive(
    resolves_to, monkeypatch
):
    """The two flags are separate. A deployment running the permissive webhook default
    must still not be able to relay a gateway call to a link-local address."""
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", True, raising=False
    )
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed", False
    )
    resolves_to(LINK_LOCAL_ADDRESS)

    with pytest.raises(EgressRefusedError):
        await open_egress(f"https://{_REGISTERED_HOST}/v1")


@pytest.mark.asyncio
async def test_gateway_egress_opt_out_admits_what_it_says_it_admits(
    resolves_to, monkeypatch
):
    """The negative control: the refusals above come from the gateway's own flag being
    enforcing, not from a hardcoded rejection."""
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed", True
    )
    resolves_to(PRIVATE_ADDRESS)

    target = await open_egress(f"http://{_REGISTERED_HOST}/v1")

    assert target.pinned_address == PRIVATE_ADDRESS
