"""Relay built-in Composio MCP endpoints through a scoped Tool Router session."""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateways.dtos import GATEWAY_ONLY_HEADERS
from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.utils.env import env


_SESSION_TTL_SECONDS = 10 * 60
_DEFAULT_TIMEOUT_SECONDS = 30.0


def _forward_headers(headers: Dict[str, str]) -> Dict[str, str]:
    """Keep client MCP headers but never forward Agenta gateway credentials."""
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in GATEWAY_ONLY_HEADERS and name.lower() != "host"
    }


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
        try:
            async with httpx.AsyncClient(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    session.mcp_url,
                    content=body,
                    headers={**_forward_headers(headers), **session.mcp_headers},
                )
        except httpx.RequestError as exc:
            raise MCPUpstreamError(target=session.mcp_url, detail=str(exc)) from exc

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
            async with httpx.AsyncClient(
                timeout=_DEFAULT_TIMEOUT_SECONDS, transport=self._transport
            ) as client:
                response = await client.post(
                    f"{self.api_url}/tool_router/session",
                    json=payload,
                    headers={
                        "x-api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                )
                response.raise_for_status()
                session = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise MCPUpstreamError(target="composio", detail=str(exc)) from exc

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
