"""HttpMcpAdapter: the south-port relay for `custom` MCP servers (entities.md §7.1).

Registered under the `"http"` key (WP9's `McpUpstreamRegistry`) and reached only via the
`custom` namespace: `agenta` targets route to the mocks/agenta adapters and `builtin`
targets route to `ComposioMcpAdapter` (out of this wave). Because only `custom` URLs are
ever handed to this class, the SSRF guard (D28) runs unconditionally on every call rather
than branching on a namespace this port is never given.
"""

from typing import Dict, Optional, Set, Tuple
from urllib.parse import urlparse, urlunparse

import httpx

from oss.src.core.gateways.mcps.dtos import (
    McpBrokeredAuth,
    McpCallContext,
    McpDirectAuth,
    McpRelayAuth,
    McpResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult, McpUpstreamInterface
from oss.src.core.gateways.mcps.types import McpUpstreamError
from oss.src.core.webhooks.utils import resolve_validated_webhook_ip
from oss.src.utils.env import env

_DEFAULT_TIMEOUT_SECONDS = 30.0


def _host_allowlist() -> Set[str]:
    return {h.strip().lower() for h in env.mcp_gateway.host_allowlist if h.strip()}


def _drop_header(headers: Dict[str, str], name: str) -> Dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() != name.lower()}


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


def _authorization_header(auth: McpDirectAuth) -> Optional[str]:
    """Derive `Authorization` from a resolved OAuth grant, when present.

    `OAuthGrantSettingsDTO` (entities.md §4.5) doesn't exist in this codebase yet — it
    is WP16 seed, wave 3 — so its future `.grant.access_token` / `.grant.token_type`
    shape is read defensively via `getattr` rather than imported, and this needs no
    change once it lands. Unreachable in Checkpoint A (D23): no OAuth targets exist yet.
    """
    if auth.credential is None:
        return None

    grant = getattr(auth.credential.secret.data, "grant", None)
    access_token = getattr(grant, "access_token", None) if grant is not None else None
    if not access_token:
        return None

    token_type = getattr(grant, "token_type", None) or "Bearer"
    return f"{token_type} {access_token}"


class HttpMcpAdapter(McpUpstreamInterface):
    """Streamable HTTP relay for `custom` MCP servers. Transparent per D16: the body
    and the upstream's response travel byte-for-byte; only the route and the
    authorization change."""

    def __init__(self, *, transport: Optional[httpx.BaseTransport] = None) -> None:
        # Injectable seam for unit tests (an httpx.MockTransport standing in for a real
        # upstream, per specs-wp8.md's test layer); None keeps the wiring-site
        # `HttpMcpAdapter()` call unchanged and uses httpx's normal transport.
        self._transport = transport

    async def relay(
        self,
        *,
        route: McpResolvedRoute,
        auth: McpRelayAuth,
        #
        context: McpCallContext,  # unused: no JSON-RPC parsing here (§7.1)
        body: bytes,
        headers: Dict[str, str],
    ) -> McpRelayResult:
        if isinstance(auth, McpBrokeredAuth):
            raise TypeError(
                "HttpMcpAdapter relays McpDirectAuth only; McpBrokeredAuth (builtin) "
                "belongs to ComposioMcpAdapter"
            )

        parsed = urlparse(route.url)
        hostname = (parsed.hostname or "").lower()

        # route.headers merged under the caller's forwarded headers (§7.1): caller
        # headers win on collision. The caller's own `Host` referred to this gateway,
        # never the upstream, so it is dropped either way.
        merged_headers = _drop_header({**route.headers, **headers}, "Host")

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
                raise McpUpstreamError(target=route.url, detail=detail) from e

            target_url, host_header = _pin_to_resolved_ip(route.url, resolved_ip)
            merged_headers["Host"] = host_header

        authorization = _authorization_header(auth)
        if authorization is not None:
            merged_headers = _drop_header(merged_headers, "Authorization")
            merged_headers["Authorization"] = authorization

        timeout = route.config.timeout_seconds or _DEFAULT_TIMEOUT_SECONDS

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
            raise McpUpstreamError(target=route.url, detail=str(e)) from e

        return McpRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )
