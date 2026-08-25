"""HTTP relay for custom MCP servers."""

from typing import Dict, Optional, Set, Tuple
from urllib.parse import urlparse, urlunparse

import httpx

from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.dtos import GATEWAY_ONLY_HEADERS
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.webhooks.utils import resolve_validated_webhook_ip
from oss.src.utils.env import env

_DEFAULT_TIMEOUT_SECONDS = 30.0


def _host_allowlist() -> Set[str]:
    return {h.strip().lower() for h in env.mcp_gateway.host_allowlist if h.strip()}


def _drop_header(headers: Dict[str, str], name: str) -> Dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() != name.lower()}


def _drop_gateway_headers(headers: Dict[str, str]) -> Dict[str, str]:
    """Remove gateway credentials before forwarding headers upstream."""
    return {k: v for k, v in headers.items() if k.lower() not in GATEWAY_ONLY_HEADERS}


def _pin_to_resolved_ip(url: str, resolved_ip: str) -> Tuple[str, str]:
    """Swap the URL host for the literal resolved IP; return (pinned_url, host_header).

    Copies the pinning in `core/webhooks/delivery.py::send_webhook_request` so a
    DNS-rebind between validation and connect cannot reach a different host than the
    one the guard just checked.
    """
    parsed = urlparse(url)
    host_literal = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
    pinned_netloc = f"{host_literal}:{parsed.port}" if parsed.port else host_literal
    pinned_url = urlunparse(parsed._replace(netloc=pinned_netloc))

    hostname = parsed.hostname or ""
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port:
        host_header = f"{host_header}:{parsed.port}"

    return pinned_url, host_header


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
        context: MCPCallContext,  # unused: no JSON-RPC parsing here (§7.1)
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        if isinstance(auth, MCPBrokeredAuth):
            raise TypeError(
                "HttpMCPAdapter relays MCPDirectAuth only; MCPBrokeredAuth (builtin) "
                "belongs to ComposioMCPAdapter"
            )

        parsed = urlparse(route.url)
        hostname = (parsed.hostname or "").lower()

        # route.headers merged under the caller's forwarded headers (§7.1): caller
        # headers win on collision. The caller's own `Host` referred to this gateway,
        # never the upstream, so it is dropped either way.
        merged_headers = _drop_gateway_headers(
            _drop_header({**route.headers, **headers}, "Host")
        )

        if hostname in _host_allowlist():
            target_url = route.url
        else:
            try:
                resolved_ip = resolve_validated_webhook_ip(route.url)
            except ValueError as e:
                message = str(e)
                # Keep a DNS typo distinct from a security rejection (runner precedent,
                # services/runner/src/engines/sandbox_agent/mcp.ts:191).
                detail = (
                    message
                    if "could not be resolved" in message
                    else f"blocked target: {message}"
                )
                raise MCPUpstreamError(target=route.url, detail=detail) from e

            target_url, host_header = _pin_to_resolved_ip(route.url, resolved_ip)
            merged_headers["Host"] = host_header

        authorization = _authorization_header(auth)
        if authorization is not None:
            merged_headers["Authorization"] = authorization

        timeout = route.settings.timeout_seconds or _DEFAULT_TIMEOUT_SECONDS

        try:
            async with httpx.AsyncClient(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    target_url,
                    content=body,
                    headers=merged_headers,
                    extensions={"sni_hostname": parsed.hostname},
                )
        except httpx.RequestError as e:
            raise MCPUpstreamError(target=route.url, detail=str(e)) from e

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )
