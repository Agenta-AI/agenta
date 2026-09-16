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

import asyncio
import json
import threading
import time
from typing import List, Optional
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from types import SimpleNamespace

from oss.src.core.gateways.egress import (
    EgressRefusedError,
    classify_transport_error,
    open_egress,
)
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpointSettings,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import RelayLLMAdapter
from oss.src.core.gateways.llms.providers.passthrough.auth import build_auth_headers
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
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import (
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomProviderKind, SecretKind
from oss.src.core.shared.dtos import Header

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


# ---------------------------------------------------------------------------
# Vertex token minting, which happens before the boundary is ever opened
# ---------------------------------------------------------------------------

_VERTEX_MINT = (
    "litellm.llms.vertex_ai.vertex_llm_base.VertexBase.get_access_token_async"
)


def _vertex_route() -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="vertex_ai",
        deployment_kind=LLMDeploymentKind.VERTEX,
        model="gemini-2.0-flash",
        extras={"vertex_project": "acme"},
        settings=LLMEndpointSettings(),
    )


def _vertex_credential(document: dict) -> ResolvedSecret:
    data = CustomProviderDTO(
        kind=CustomProviderKind.CUSTOM,
        provider=CustomProviderSettingsDTO(
            key=None, extras={"vertex_ai_credentials": json.dumps(document)}
        ),
        models=[],
    ).model_dump()
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.CUSTOM_PROVIDER, data=data, header=Header(name="vertex")
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _service_account(**overrides) -> dict:
    document = {
        "type": "service_account",
        "project_id": "acme",
        "client_email": "synthetic@acme.iam.gserviceaccount.com",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    document.update(overrides)
    return document


@pytest.mark.asyncio
async def test_vertex_token_uri_pointing_at_loopback_is_refused_without_minting():
    """The token mint is an outbound call nothing here makes: google-auth POSTs to the
    `token_uri` written inside the tenant's own credential document, over its own transport,
    while `build_auth_headers` is still running — before `open_egress` has seen anything. So
    a document naming a loopback address reached an internal port with no check at all."""
    with patch(_VERTEX_MINT, new_callable=AsyncMock) as mint:
        with pytest.raises(LLMUpstreamError) as excinfo:
            await build_auth_headers(
                _vertex_route(),
                _vertex_credential(
                    _service_account(token_uri="http://127.0.0.1:8080/token")
                ),
            )

    assert "blocked target" in (excinfo.value.detail or "")
    mint.assert_not_awaited()


@pytest.mark.asyncio
async def test_vertex_credential_urls_other_than_token_uri_are_checked_too(resolves_to):
    """Which field a given google-auth version dials is the library's business: a workload
    identity document carries `token_url`, `service_account_impersonation_url` and a
    `credential_source.url` besides. Every URL in the document goes through the boundary."""
    resolves_to(LINK_LOCAL_ADDRESS)

    with patch(_VERTEX_MINT, new_callable=AsyncMock) as mint:
        with pytest.raises(LLMUpstreamError) as excinfo:
            await build_auth_headers(
                _vertex_route(),
                _vertex_credential(
                    {
                        "type": "external_account",
                        "token_url": "https://sts.googleapis.com/v1/token",
                        "credential_source": {
                            "url": "https://metadata.internal.example/token"
                        },
                    }
                ),
            )

    assert "blocked target" in (excinfo.value.detail or "")
    mint.assert_not_awaited()


@pytest.mark.asyncio
async def test_vertex_credential_naming_an_executable_source_is_refused():
    """google-auth's pluggable source runs a subprocess. Nothing a tenant stores names a
    program for the platform to execute, whatever the library's own opt-in says."""
    with patch(_VERTEX_MINT, new_callable=AsyncMock) as mint:
        with pytest.raises(LLMUpstreamError):
            await build_auth_headers(
                _vertex_route(),
                _vertex_credential(
                    {
                        "type": "external_account",
                        "credential_source": {"executable": {"command": "/bin/false"}},
                    }
                ),
            )

    mint.assert_not_awaited()


@pytest.mark.asyncio
async def test_vertex_document_with_public_urls_still_mints():
    """The negative control: the refusals above come from the boundary, not from Vertex
    having been switched off."""
    with patch(
        _VERTEX_MINT, new_callable=AsyncMock, return_value=("minted-token", "acme")
    ) as mint:
        headers = await build_auth_headers(
            _vertex_route(), _vertex_credential(_service_account())
        )

    assert headers == {"Authorization": "Bearer minted-token"}
    mint.assert_awaited_once()


# ---------------------------------------------------------------------------
# The pin must not make two origins look like one to the connection pool
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_hostnames_on_one_address_do_not_share_a_pooled_connection():
    """Pinning rewrites the URL host to the checked literal address, and httpcore keys
    connection reuse on that rewritten origin (`AsyncHTTPConnection.can_handle_request`
    compares scheme/host/port and nothing else). `sni_hostname` is read at handshake time
    and never enters the key. So two tenants whose hostnames resolve to one address shared a
    TLS connection, and the second tenant's credential travelled over a connection opened,
    and certificate-checked, for the first tenant's name."""
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    await _relay_llm(adapter, base_url="https://first.example/v1")
    await _relay_llm(adapter, base_url="https://second.example/v1")

    # What the pool would have keyed on: identical, because both were pinned to one address.
    assert len({str(request.url.host) for request in seen}) == 1
    # What actually distinguishes them: an extension, plus the authority in `Host`.
    assert [request.extensions["sni_hostname"] for request in seen] == [
        "first.example",
        "second.example",
    ]
    # So the identity has to come from somewhere the pool respects: separate pools.
    assert sorted(adapter._clients) == [
        "https://first.example:443",
        "https://second.example:443",
    ]
    assert (
        adapter._clients["https://first.example:443"]
        is not adapter._clients["https://second.example:443"]
    )


@pytest.mark.asyncio
async def test_repeated_calls_to_one_origin_still_share_a_pool():
    """The reason the pooled client exists at all: a streaming response outlives the method
    that opened it, so clients are kept and reused. Partitioning by origin must not turn
    that into a client per call."""
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    await _relay_llm(adapter, base_url="https://first.example/v1")
    await _relay_llm(adapter, base_url="https://first.example/v2")

    assert list(adapter._clients) == ["https://first.example:443"]
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_pooled_clients_keep_the_pin_and_refuse_redirects():
    """Whatever the pooling, each client is still the hardened one: no cookie jar carried
    between tenants, and no redirect to a host nothing checked."""
    seen: List[httpx.Request] = []
    adapter = _llm_adapter(_recording_handler(seen))

    await _relay_llm(adapter, base_url="https://first.example/v1")

    client = adapter._clients["https://first.example:443"]
    assert client.follow_redirects is False
    assert list(client.cookies.jar) == []
    assert str(seen[0].url.host) == PUBLIC_ADDRESS


# ---------------------------------------------------------------------------
# OR86: classifying a transport failure instead of quoting it
# ---------------------------------------------------------------------------


class TestClassifyTransportError:
    """`str(httpx.RequestError)` can quote the request the gateway built, credential
    included. Every call site now asks this instead."""

    def test_a_local_protocol_refusal_never_carries_the_bytes_it_refused(self):
        secret = "ag-secret-value-DO-NOT-LEAK"
        exc = httpx.LocalProtocolError(f"Illegal header value b'Bearer {secret}\n'")

        failure = classify_transport_error(exc)

        assert secret not in failure.detail
        assert failure.cause == "request_rejected"

    def test_the_bytes_it_refused_are_not_logged_either(self, monkeypatch):
        """An application log is not a caller, but it is not a vault either, and this is
        the one class whose text is the credential."""
        recorded = []
        monkeypatch.setattr(
            "oss.src.core.gateways.egress.log",
            SimpleNamespace(warning=lambda *a, **kw: recorded.append(kw)),
        )
        secret = "ag-secret-value-DO-NOT-LEAK"

        classify_transport_error(
            httpx.LocalProtocolError(f"Illegal header value b'Bearer {secret}\n'")
        )

        assert recorded
        assert all(secret not in str(entry) for entry in recorded)
        assert recorded[-1]["error_class"] == "LocalProtocolError"

    def test_a_reachability_failure_is_logged_with_its_text(self, monkeypatch):
        """The classes whose text is about the network, not about the request, stay
        diagnosable server-side."""
        recorded = []
        monkeypatch.setattr(
            "oss.src.core.gateways.egress.log",
            SimpleNamespace(warning=lambda *a, **kw: recorded.append(kw)),
        )

        classify_transport_error(httpx.ConnectError("Name or service not known"))

        assert recorded[-1]["error"] == "Name or service not known"

    @pytest.mark.parametrize(
        "exc, cause",
        [
            (httpx.ConnectTimeout("x"), "timeout"),
            (httpx.ReadTimeout("x"), "timeout"),
            (httpx.PoolTimeout("x"), "timeout"),
            (httpx.LocalProtocolError("x"), "request_rejected"),
            (httpx.RemoteProtocolError("x"), "protocol_error"),
            (httpx.ProxyError("x"), "proxy_error"),
            (httpx.UnsupportedProtocol("x"), "unsupported_protocol"),
            (httpx.ConnectError("x"), "connect_error"),
            (httpx.TooManyRedirects("x"), "too_many_redirects"),
            (httpx.ReadError("x"), "transport_error"),
            (httpx.WriteError("x"), "transport_error"),
        ],
    )
    def test_every_transport_error_lands_in_the_closed_vocabulary(self, exc, cause):
        """The table ends at `RequestError`, so nothing an httpx release adds can fall
        through to an unclassified quote."""
        assert classify_transport_error(exc).cause == cause

    def test_no_classified_detail_interpolates_the_exception(self):
        secret = "another-secret-DO-NOT-LEAK"
        for kind in (
            httpx.ConnectTimeout,
            httpx.LocalProtocolError,
            httpx.RemoteProtocolError,
            httpx.ProxyError,
            httpx.UnsupportedProtocol,
            httpx.ConnectError,
            httpx.TooManyRedirects,
            httpx.ReadError,
        ):
            failure = classify_transport_error(kind(secret))
            assert secret not in failure.detail


# ---------------------------------------------------------------------------
# M18 residual: the relay path's own resolution is bounded, on our own threads
# ---------------------------------------------------------------------------


class TestResolutionIsBoundedOnTheRelayPath:
    """`open_egress` runs the same blocking resolution every gateway call goes through,
    and it had no bound at all: one address whose resolver hangs held a request open for
    as long as the resolver did."""

    @pytest.mark.asyncio
    async def test_a_resolver_that_never_answers_refuses_instead_of_waiting(
        self, monkeypatch
    ):
        released = threading.Event()

        def hang(*_args, **_kwargs):
            released.wait(timeout=30)
            return PUBLIC_ADDRESS

        monkeypatch.setattr("oss.src.core.gateways.egress.resolve_validated_ip", hang)
        monkeypatch.setattr(
            "oss.src.core.gateways.egress._RESOLVE_TIMEOUT_SECONDS", 0.2
        )

        started = time.monotonic()
        try:
            with pytest.raises(EgressRefusedError) as excinfo:
                await open_egress("https://slow.example.com/mcp")
        finally:
            released.set()
        elapsed = time.monotonic() - started

        # Told apart from a security rejection, so an adapter reports it as an address
        # problem rather than a blocked target.
        assert excinfo.value.unresolvable is True
        assert "in time" in excinfo.value.detail
        assert elapsed < 5

    @pytest.mark.asyncio
    async def test_the_loop_keeps_serving_while_a_resolution_is_stuck(
        self, monkeypatch
    ):
        released = threading.Event()
        ticks = 0

        def hang(*_args, **_kwargs):
            released.wait(timeout=30)
            return PUBLIC_ADDRESS

        monkeypatch.setattr("oss.src.core.gateways.egress.resolve_validated_ip", hang)
        monkeypatch.setattr(
            "oss.src.core.gateways.egress._RESOLVE_TIMEOUT_SECONDS", 0.3
        )

        async def keep_working():
            nonlocal ticks
            for _ in range(5):
                await asyncio.sleep(0.01)
                ticks += 1

        async def refused():
            with pytest.raises(EgressRefusedError):
                await open_egress("https://slow.example.com/mcp")

        try:
            await asyncio.gather(refused(), keep_working())
        finally:
            released.set()

        assert ticks == 5

    @pytest.mark.asyncio
    async def test_resolution_does_not_run_on_the_loops_shared_executor(
        self, monkeypatch
    ):
        """A blocked resolution must not take threads from everything else in the
        process, which is what `asyncio.to_thread` would have done."""
        default_pool_threads: list = []
        resolver_threads: list = []

        def resolve(*_args, **_kwargs):
            resolver_threads.append(threading.current_thread().name)
            return PUBLIC_ADDRESS

        monkeypatch.setattr(
            "oss.src.core.gateways.egress.resolve_validated_ip", resolve
        )

        await open_egress("https://example.com/mcp")
        await asyncio.to_thread(
            lambda: default_pool_threads.append(threading.current_thread().name)
        )

        assert resolver_threads and resolver_threads[0].startswith("gateway-resolver")
        assert default_pool_threads
        assert resolver_threads[0] != default_pool_threads[0]

    @pytest.mark.asyncio
    async def test_an_address_that_resolves_promptly_is_unaffected(self, monkeypatch):
        monkeypatch.setattr(
            "oss.src.core.gateways.egress.resolve_validated_ip",
            lambda *_a, **_kw: PUBLIC_ADDRESS,
        )

        target = await open_egress("https://example.com/mcp")

        assert target.pinned_address == PUBLIC_ADDRESS
