"""HTTP relay for custom MCP servers."""

from typing import Dict, Optional

import httpx

from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPRelayAuth,
    MCPResolvedRoute,
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

_DEFAULT_TIMEOUT_SECONDS = 30.0

# Where an API-key endpoint's credential goes when its route names no header of its own.
# `Bearer` is what an MCP server that documents no header of its own expects, and it is
# what the LLM plane sends a custom endpoint.
_DEFAULT_CREDENTIAL_HEADER = "Authorization"
_DEFAULT_CREDENTIAL_SCHEME = "Bearer"


def _api_key_value(data: object) -> Optional[str]:
    """The key inside an API-key secret, whichever vault shape holds it.

    Two shapes reach an MCP endpoint. A project-named secret (`custom_secret`), which is
    what the agent config's `header_secret_refs` picks and therefore what registration
    binds, keeps its value in `secret.content`; a provider-key record keeps it in
    `provider.key`. A JSON-format named secret is a map with no single credential in it,
    so it yields nothing rather than a guess at which entry is the key.
    """
    provider = getattr(data, "provider", None)
    key = getattr(provider, "key", None) if provider is not None else None
    if isinstance(key, str) and key:
        return key

    stored = getattr(data, "secret", None)
    content = getattr(stored, "content", None) if stored is not None else None
    return content if isinstance(content, str) and content else None


def _credential_headers(route: MCPResolvedRoute, auth: MCPDirectAuth) -> Dict[str, str]:
    """The credential the gateway injects for this endpoint, as headers.

    Credentials live only in the vault. The endpoint carries their opaque `secret_id`, so
    neither its DTO nor its route can expose token material; only the header *name* is
    endpoint configuration.

    An OAuth grant always travels as `Authorization: <token_type> <access_token>`, which
    is the scheme the authorization server issued it under. An API key travels in the
    header the endpoint registered (`route.credential_header`) with its value verbatim and
    no scheme prefix, which is the binding the agent config already expresses as
    `credentials.header_secret_refs` and the SDK already sends when it dials a server
    directly — so a server reached through the gateway sees the same request it would have
    seen without one. An endpoint that registered no header name falls back to
    `Authorization: Bearer <key>`.
    """
    if auth.secret is None:
        return {}

    data = auth.secret.secret.data

    grant = getattr(data, "grant", None)
    access_token = getattr(grant, "access_token", None) if grant is not None else None
    if access_token:
        token_type = getattr(grant, "token_type", None) or _DEFAULT_CREDENTIAL_SCHEME
        return {_DEFAULT_CREDENTIAL_HEADER: f"{token_type} {access_token}"}

    key = _api_key_value(data)
    if not key:
        return {}

    header = (route.credential_header or "").strip()
    if not header:
        return {
            _DEFAULT_CREDENTIAL_HEADER: f"{_DEFAULT_CREDENTIAL_SCHEME} {key}",
        }
    return {header: key}


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

        credentials = _credential_headers(route, auth)

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
                above_caller=credentials or None,
            )
        except EgressRefusedError as e:
            raise MCPUpstreamError(target=route.url, detail=e.relay_detail) from e

        timeout = route.settings.timeout_seconds or _DEFAULT_TIMEOUT_SECONDS

        try:
            async with egress_client(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    target.url,
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
            scanner=credential_echo_scanner(credentials),
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
