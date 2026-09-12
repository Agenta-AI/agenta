"""Project-key Composio MCP relay."""

from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from oss.src.core.gateways.dtos import GATEWAY_ONLY_HEADERS
from oss.src.core.gateways.mcps.dtos import (
    COMPOSIO_PROVIDER,
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.secrets.enums import SecretKind
from oss.src.utils.env import env

_DEFAULT_TIMEOUT_SECONDS = 30.0


def _project_api_key(auth: MCPRelayAuth) -> str:
    if not isinstance(auth, MCPDirectAuth) or auth.secret is None:
        raise MCPUpstreamError(
            target="standard/composio",
            detail="standard Composio requires a project-owned provider key",
        )

    secret = auth.secret.secret
    data = secret.data
    if (
        secret.kind != SecretKind.PROVIDER_KEY
        or getattr(data, "kind", None) != COMPOSIO_PROVIDER
        or not getattr(getattr(data, "provider", None), "key", None)
    ):
        raise MCPUpstreamError(
            target="standard/composio",
            detail="standard Composio requires a project-owned Composio provider key",
        )
    return data.provider.key


def _forward_headers(headers: Dict[str, str]) -> Dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in GATEWAY_ONLY_HEADERS
        and name.lower() not in {"host", "content-length"}
    }


class StandardComposioMCPAdapter(MCPUpstreamInterface):
    """Relay `standard/composio` through a project-owned Tool Router session.

    The developer key is resolved from the project vault for each call.  The
    deployment key is deliberately not an input to this adapter.  Composio's
    ``user_id`` is the project UUID, so connected accounts and hosted callback
    state are isolated within the project's own Composio account.
    """

    def __init__(
        self,
        *,
        api_url: Optional[str] = None,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self.api_url = (api_url or env.composio.api_url).rstrip("/")
        self._transport = transport

    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        del context
        if isinstance(auth, MCPBrokeredAuth):
            raise TypeError(
                "StandardComposioMCPAdapter relays MCPDirectAuth only; "
                "brokered connections belong to builtin Composio"
            )
        if route.project_id is None:
            raise MCPUpstreamError(
                target="standard/composio",
                detail="standard Composio route is missing its project scope",
            )

        api_key = _project_api_key(auth)
        timeout = route.settings.timeout_seconds or _DEFAULT_TIMEOUT_SECONDS
        session_url, session_headers = await self._create_session(
            api_key=api_key,
            project_id=str(route.project_id),
            timeout=timeout,
        )
        try:
            async with httpx.AsyncClient(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    session_url,
                    content=body,
                    headers={**_forward_headers(headers), **session_headers},
                )
        except httpx.RequestError as exc:
            raise MCPUpstreamError(target=session_url, detail=str(exc)) from exc

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )

    async def _create_session(
        self, *, api_key: str, project_id: str, timeout: float
    ) -> tuple[str, Dict[str, str]]:
        try:
            async with httpx.AsyncClient(
                timeout=timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    f"{self.api_url}/tool_router/session",
                    json={"user_id": project_id, "mcp": True},
                    headers={"x-api-key": api_key, "Content-Type": "application/json"},
                )
                response.raise_for_status()
                session: Any = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise MCPUpstreamError(target="standard/composio", detail=str(exc)) from exc

        if not isinstance(session, dict):
            raise MCPUpstreamError(
                target="standard/composio",
                detail="session creation returned a malformed body",
            )
        mcp = session.get("mcp")
        mcp_url = mcp.get("url") if isinstance(mcp, dict) else None
        parsed = urlparse(mcp_url) if isinstance(mcp_url, str) else None
        if not parsed or parsed.scheme != "https" or not parsed.hostname:
            raise MCPUpstreamError(
                target="standard/composio",
                detail="session creation returned no valid HTTPS MCP URL",
            )
        mcp_headers = mcp.get("headers") or {}
        if not isinstance(mcp_headers, dict) or not all(
            isinstance(name, str) and isinstance(value, str)
            for name, value in mcp_headers.items()
        ):
            raise MCPUpstreamError(
                target="standard/composio",
                detail="session creation returned malformed MCP headers",
            )
        return mcp_url, mcp_headers
