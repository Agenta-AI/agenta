"""Relay built-in Composio MCP endpoints through a scoped Tool Router session."""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateways.egress import (
    EgressRefusedError,
    classify_transport_error,
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.echo import (
    credential_echo_scanner,
    refuse_credential_echo,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.utils.env import env


_SESSION_TTL_SECONDS = 10 * 60
_DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class _CachedSession:
    mcp_url: str
    mcp_headers: Dict[str, str]
    expires_at: float


class ComposioMCPAdapter(MCPUpstreamInterface):
    """Built-in Composio MCP relay.

    Composio's current MCP API is its Tool Router session endpoint.  A session is
    created for the same project identifier used when the connection was linked,
    restricted to exactly one integration and, when applicable, one connected
    account.  Its hosted MCP URL is an internal capability URL: it is never
    returned to the caller and the deployment ``COMPOSIO_API_KEY`` is sent only
    to Composio's control-plane API.
    """

    def __init__(
        self,
        *,
        api_key: str,
        api_url: Optional[str] = None,
        transport: Optional[httpx.BaseTransport] = None,
        session_ttl_seconds: float = _SESSION_TTL_SECONDS,
    ) -> None:
        self.api_key = api_key
        self.api_url = (api_url or env.composio.api_url).rstrip("/")
        self._transport = transport
        self._session_ttl_seconds = session_ttl_seconds
        self._sessions: Dict[str, _CachedSession] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    async def close(self) -> None:
        """Drop locally cached capability URLs during application shutdown."""
        self._sessions.clear()
        self._locks.clear()

    async def relay(
        self,
        *,
        route: MCPResolvedRoute,  # route is a logical placeholder for builtins
        auth: MCPRelayAuth,
        context: MCPCallContext,  # the hosted MCP server owns JSON-RPC handling
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        del route, context
        if not isinstance(auth, MCPBrokeredAuth):
            raise TypeError(
                "ComposioMCPAdapter relays MCPBrokeredAuth only; "
                "MCPDirectAuth belongs to direct MCP adapters"
            )

        connection = auth.connection
        session = await self._session(connection)
        timeout = _DEFAULT_TIMEOUT_SECONDS
        # The session's own capability headers win over anything the caller sent, in any
        # casing; only allowlisted caller headers travel at all. `mcp_url` came back in
        # Composio's response rather than from our configuration, so it takes the same
        # egress boundary as any other upstream-supplied address (OD26).
        try:
            target = await open_egress(
                session.mcp_url,
                caller_headers=headers,
                above_caller=session.mcp_headers,
            )
        except EgressRefusedError as exc:
            raise MCPUpstreamError(
                target=session.mcp_url, detail=exc.relay_detail
            ) from exc

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
        except httpx.RequestError as exc:
            # The Composio session credential is in these headers (OR86).
            failure = classify_transport_error(exc)
            raise MCPUpstreamError(
                target=session.mcp_url, detail=failure.detail
            ) from exc

        # OR75: the session credential Composio issued for this connection is injected
        # above the caller's headers, so a response that returns it is refused rather
        # than relayed into the sandbox.
        refuse_credential_echo(
            scanner=credential_echo_scanner(session.mcp_headers),
            target=session.mcp_url,
            status_code=response.status_code,
            headers=response.headers,
            body=response.content,
        )

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )

    async def _session(self, connection: Connection) -> _CachedSession:
        cache_key = str(connection.id)
        cached = self._sessions.get(cache_key)
        if cached is not None and cached.expires_at > time.monotonic():
            return cached

        lock = self._locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            cached = self._sessions.get(cache_key)
            if cached is not None and cached.expires_at > time.monotonic():
                return cached

            session = await self._create_session(connection)
            cached = _CachedSession(
                mcp_url=session[0],
                mcp_headers=session[1],
                expires_at=time.monotonic() + self._session_ttl_seconds,
            )
            self._sessions[cache_key] = cached
            return cached

    async def _create_session(
        self, connection: Connection
    ) -> tuple[str, Dict[str, str]]:
        data = connection.data if isinstance(connection.data, dict) else {}
        project_id = data.get("project_id")
        if not isinstance(project_id, str) or not project_id:
            raise MCPUpstreamError(
                target="composio",
                detail="connection is missing its project-scoped Composio user id",
            )

        integration = connection.integration_key
        payload: Dict[str, Any] = {
            "user_id": project_id,
            "mcp": True,
            "toolkits": {"enabled": [integration]},
        }
        connected_account_id = connection.provider_connection_id
        if connected_account_id:
            payload["connected_accounts"] = {
                integration: [connected_account_id],
            }

        try:
            target = await open_egress(
                f"{self.api_url}/tool_router/session",
                above_caller={
                    "x-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
            )
        except EgressRefusedError as exc:
            raise MCPUpstreamError(target="composio", detail=exc.relay_detail) from exc

        try:
            async with egress_client(
                timeout=_DEFAULT_TIMEOUT_SECONDS,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    target.url,
                    json=payload,
                    headers=target.headers,
                    extensions=target.extensions,
                )
                response.raise_for_status()
                session = response.json()
        except httpx.RequestError as exc:
            failure = classify_transport_error(exc)
            raise MCPUpstreamError(target="composio", detail=failure.detail) from exc
        except (httpx.HTTPError, ValueError) as exc:
            # A status error quotes the URL and a decode error quotes the body, and a
            # body may echo what it was sent (OR75). Neither is put on a caller's field.
            raise MCPUpstreamError(
                target="composio", detail="session creation failed"
            ) from exc

        if not isinstance(session, dict):
            raise MCPUpstreamError(
                target="composio", detail="session creation returned a malformed body"
            )
        mcp = session.get("mcp")
        mcp_url = mcp.get("url") if isinstance(mcp, dict) else None
        parsed = urlparse(mcp_url) if isinstance(mcp_url, str) else None
        if not parsed or parsed.scheme != "https" or not parsed.hostname:
            raise MCPUpstreamError(
                target="composio",
                detail="session creation returned no valid HTTPS MCP URL",
            )
        mcp_headers = mcp.get("headers") or {}
        if not isinstance(mcp_headers, dict) or not all(
            isinstance(name, str) and isinstance(value, str)
            for name, value in mcp_headers.items()
        ):
            raise MCPUpstreamError(
                target="composio",
                detail="session creation returned malformed MCP headers",
            )
        return mcp_url, mcp_headers
