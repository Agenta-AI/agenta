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
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError

_DEFAULT_TIMEOUT_SECONDS = 30.0


def _authorization_header(auth: MCPDirectAuth) -> Optional[str]:
    """Derive `Authorization` from a resolved OAuth grant, when present.

    OAuth grants live only in the vault. The endpoint carries their opaque `secret_id`,
    so neither its DTO nor its route can expose token material.
    """
    if auth.secret is None:
        return None

    grant = getattr(auth.secret.secret.data, "grant", None)
    access_token = getattr(grant, "access_token", None) if grant is not None else None
    if not access_token:
        return None

    token_type = getattr(grant, "token_type", None) or "Bearer"
    return f"{token_type} {access_token}"


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

        authorization = _authorization_header(auth)

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
                above_caller=(
                    {"Authorization": authorization}
                    if authorization is not None
                    else None
                ),
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
            raise MCPUpstreamError(target=route.url, detail=str(e)) from e

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )
