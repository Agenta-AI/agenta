"""HTTP relay for custom MCP servers."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import httpx

from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPCredentialBinding,
    MCPDirectAuth,
    MCPRelayAuth,
    MCPResolvedRoute,
    api_key_value,
    with_url_secret,
)
from oss.src.core.gateways.egress import (
    EgressRefusedError,
    classify_transport_error,
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.echo import (
    credential_echo_scanner,
    refuse_credential_echo,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError

#: The gateway's upstream budget for one MCP relay, when the endpoint names none of its own.
#:
#: The Pi MCP client mirrors this as `GATEWAY_MCP_BUDGET_MS` in
#: `services/runner/src/extensions/pi-mcp.ts` and bounds its tool calls at this plus a return-trip
#: margin, because that client's only peer is this gateway. Raising this without raising that one
#: gives back a defect D65 already cost us: the client cancels at its own bound while the gateway
#: is still waiting, and the turn fails on work that was going to succeed.
_DEFAULT_TIMEOUT_SECONDS = 30.0

# How an API-key endpoint's credential travels when its route names no binding of its own.
# `Bearer` is what an MCP server that documents no header of its own expects, and it is
# what the LLM plane sends a custom endpoint. An OAuth grant always travels this way.
_DEFAULT_CREDENTIAL_HEADER = "Authorization"
_DEFAULT_CREDENTIAL_SCHEME = "Bearer"
_DEFAULT_CREDENTIAL_BINDING = MCPCredentialBinding(
    kind="header",
    name=_DEFAULT_CREDENTIAL_HEADER,
    prefix=_DEFAULT_CREDENTIAL_SCHEME,
)


@dataclass(frozen=True)
class InjectedCredentials:
    """What the gateway adds to one upstream request: headers, query parameters, and the
    value for the URL's `{secret}`.

    The URL parts are added to the request at send time and never to `route.url`, which is
    the stored URL that error targets, logs and traces show.
    """

    headers: Dict[str, str] = field(default_factory=dict)
    query: Dict[str, str] = field(default_factory=dict)
    url_secret: Optional[str] = None

    @property
    def url_values(self) -> List[str]:
        """Every value this request carries in its URL, for the echo scanner."""
        values = list(self.query.values())
        if self.url_secret is not None:
            values.append(self.url_secret)
        return values

    def request_url(self, url: str) -> httpx.URL:
        """`url` with the URL parts added. Merged into the URL rather than passed as
        `params`, which would replace the stored URL's own query."""
        if self.url_secret is not None:
            url = with_url_secret(url, self.url_secret)
        return httpx.URL(url).copy_merge_params(self.query)


def injected_credentials(
    route: MCPResolvedRoute, auth: MCPDirectAuth
) -> InjectedCredentials:
    """The credential the gateway injects for this endpoint.

    Credentials live only in the vault. The endpoint carries their opaque `secret_id`, so
    neither its DTO nor its route can expose token material; only the binding is endpoint
    configuration.

    An OAuth grant always travels as `Authorization: <token_type> <access_token>`, which
    is the scheme the authorization server issued it under. An API key travels where the
    endpoint's binding says (`route.credential_binding`), with the binding's prefix in
    front of it when it has one.
    """
    if auth.secret is None:
        return InjectedCredentials()

    data = auth.secret.secret.data

    grant = getattr(data, "grant", None)
    access_token = getattr(grant, "access_token", None) if grant is not None else None
    if access_token:
        token_type = getattr(grant, "token_type", None) or _DEFAULT_CREDENTIAL_SCHEME
        return InjectedCredentials(
            headers={_DEFAULT_CREDENTIAL_HEADER: f"{token_type} {access_token}"}
        )

    key = api_key_value(data)
    if not key:
        return InjectedCredentials()

    return bound_credentials(route.credential_binding, key)


def bound_credentials(
    binding: Optional[MCPCredentialBinding], key: str
) -> InjectedCredentials:
    """An API key placed where `binding` says, or as a Bearer token when it says nothing."""
    binding = binding or _DEFAULT_CREDENTIAL_BINDING
    if binding.kind == "url":
        return InjectedCredentials(url_secret=key)
    value = f"{binding.prefix} {key}" if binding.prefix else key
    if binding.kind == "query":
        return InjectedCredentials(query={binding.name: value})
    return InjectedCredentials(headers={binding.name: value})


class HttpMCPAdapter(MCPUpstreamInterface):
    """Streamable HTTP relay for custom MCP servers. The body and upstream response
    travel byte-for-byte; only the route and the
    authorization change."""

    def __init__(self, *, transport: Optional[httpx.BaseTransport] = None) -> None:
        # Tests may inject an HTTP transport.
        self._transport = transport

    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        #
        context: MCPCallContext,  # parsed by the gateway for policy; body stays raw
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        if isinstance(auth, MCPBrokeredAuth):
            raise TypeError(
                "HttpMCPAdapter relays MCPDirectAuth only; MCPBrokeredAuth (builtin) "
                "belongs to ComposioMCPAdapter"
            )

        credentials = injected_credentials(route, auth)

        # route.headers merged under the caller's forwarded headers (§7.1): caller
        # headers win on collision, but only the allowlisted ones travel at all. The
        # caller's own `Host` referred to this gateway, never the upstream, and its
        # `Authorization` and `Cookie` authenticate it to us, so none of the three is on
        # the allowlist. The endpoint's own grant is layered last so it wins outright.
        try:
            target = await open_egress(
                route.url,
                beneath_caller=route.headers,
                caller_headers=headers,
                above_caller=credentials.headers or None,
            )
        except EgressRefusedError as e:
            raise MCPUpstreamError(target=route.url, detail=e.relay_detail) from e

        timeout = route.settings.timeout_seconds or _DEFAULT_TIMEOUT_SECONDS

        try:
            async with egress_client(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    # Added here and nowhere earlier, so the egress check, its refusals
                    # and `route.url` all carry the URL without the credential.
                    credentials.request_url(target.url),
                    content=body,
                    headers=target.headers,
                    extensions=target.extensions,
                )
        except httpx.RequestError as e:
            # Never `str(e)`: the connection's own grant is in the headers this request
            # carries, and a refusal raised while building it quotes them (OR86).
            failure = classify_transport_error(e)
            raise MCPUpstreamError(target=route.url, detail=failure.detail) from e

        # OR75: an upstream that returns the grant it was sent would hand a vault
        # credential to the sandbox. The whole response is in hand, so it is checked
        # before any of it is relayed.
        refuse_credential_echo(
            scanner=credential_echo_scanner(
                credentials.headers, url_values=credentials.url_values
            ),
            target=route.url,
            status_code=response.status_code,
            headers=response.headers,
            body=response.content,
        )

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )
