"""Resolution of MCP server declarations into runner configuration."""

from __future__ import annotations

from typing import Mapping, Optional, Sequence

from agenta.sdk.agents.tools.models import MissingSecretPolicy
from agenta.sdk.utils.net import assert_endpoint_url_allowed

from .errors import MCPServerURLBlockedError, MissingMCPSecretError
from .interfaces import MCPSecretProvider
from .models import (
    HeaderCredentialBinding,
    MCPHeaderSecretRefs,
    MCPServerConfig,
    ResolvedMCPCredential,
    ResolvedMCPServer,
)

# The header our own credentials ride, per D31 — same default as the LLM plane's
# ``GatewayCredentials.header`` (connections/models.py), duplicated rather than imported
# because that module belongs to a different package (WP12).
_GATEWAY_CREDENTIALS_HEADER = "X-AG-Credentials"


def _gateway_mcp_route(*, namespace: str, name: str, gateway_base_url: str) -> str:
    """The gateway route base URL (D30): ``{gateway_base}/gateways/mcps/{namespace}/{name}``.

    The MCP protocol POSTs to this URL directly; nothing is appended.
    """
    return f"{gateway_base_url.rstrip('/')}/gateways/mcps/{namespace}/{name}"


class MCPResolver:
    """Resolve author-declared MCP servers.

    Every server this resolver is handed is a D30 ``custom`` target (D27/D30: "a server
    they brought"), so when a gateway is configured it routes through
    ``custom/{server.name}`` with OUR credentials (D31) rather than dialling the author's
    URL directly with named secrets. With no gateway configured (the offline/standalone
    case, mirroring ``EnvConnectionResolver``/``StaticConnectionResolver`` on the LLM
    side) it falls back to the direct dial, unchanged.
    """

    def __init__(
        self,
        *,
        secret_provider: MCPSecretProvider,
        missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
        gateway_base_url: Optional[str] = None,
        gateway_credentials_value: Optional[str] = None,
    ) -> None:
        self._secret_provider = secret_provider
        self._missing_secret_policy = missing_secret_policy
        self._gateway_base_url = gateway_base_url
        self._gateway_credentials_value = gateway_credentials_value

    async def resolve(
        self,
        server_configs: Sequence[MCPServerConfig],
    ) -> list[ResolvedMCPServer]:
        if self._gateway_base_url and self._gateway_credentials_value:
            return [
                self._resolve_gateway(server_config) for server_config in server_configs
            ]
        return await self._resolve_direct(server_configs)

    def _resolve_gateway(self, server_config: MCPServerConfig) -> ResolvedMCPServer:
        """Route through the gateway: no upstream secret ever reaches the sandbox (WP13's
        contract, on the tool side). ``policy.tools`` and the public headers pass through
        unchanged; the author's URL and named secret refs are not used — the gateway's own
        stored endpoint (registered under this server's ``name``) knows the real upstream."""
        assert self._gateway_base_url is not None  # narrowed by the caller above
        assert self._gateway_credentials_value is not None
        return ResolvedMCPServer(
            name=server_config.name,
            url=_gateway_mcp_route(
                namespace="custom",
                name=server_config.name,
                gateway_base_url=self._gateway_base_url,
            ),
            headers=dict(server_config.connection.headers),
            credentials=[
                ResolvedMCPCredential(
                    binding=HeaderCredentialBinding(name=_GATEWAY_CREDENTIALS_HEADER),
                    value=self._gateway_credentials_value,
                )
            ],
            policy=server_config.policy,
        )

    async def _resolve_direct(
        self,
        server_configs: Sequence[MCPServerConfig],
    ) -> list[ResolvedMCPServer]:
        secret_names = sorted(
            {
                secret_name
                for server_config in server_configs
                if isinstance(server_config.connection.credentials, MCPHeaderSecretRefs)
                for secret_name in server_config.connection.credentials.headers.values()
            }
        )
        secret_values: Mapping[str, str] = (
            await self._secret_provider.get_many(secret_names) if secret_names else {}
        )

        resolved: list[ResolvedMCPServer] = []
        for server_config in server_configs:
            credentials = server_config.connection.credentials
            secret_refs = (
                credentials.headers
                if isinstance(credentials, MCPHeaderSecretRefs)
                else {}
            )
            # An empty resolved value is as unusable as an absent one, so both are missing.
            missing = [
                secret_name
                for secret_name in secret_refs.values()
                if not secret_values.get(secret_name)
            ]
            if missing and self._missing_secret_policy == MissingSecretPolicy.ERROR:
                raise MissingMCPSecretError(
                    server_name=server_config.name,
                    secret_names=missing,
                )

            if server_config.connection.url:
                try:
                    assert_endpoint_url_allowed(server_config.connection.url)
                except ValueError as exc:
                    raise MCPServerURLBlockedError(
                        server_name=server_config.name,
                        url=server_config.connection.url,
                    ) from exc

            # Public headers and secret header credentials stay separate by protocol role:
            # each resolved secret becomes a typed header binding, never a merged header.
            credentials = [
                {
                    "binding": {"kind": "header", "name": header_name},
                    "value": secret_values[secret_name],
                    "usage": "opaque_http",
                }
                for header_name, secret_name in secret_refs.items()
                if secret_values.get(secret_name)
            ]

            resolved.append(
                ResolvedMCPServer(
                    name=server_config.name,
                    url=server_config.connection.url,
                    headers=dict(server_config.connection.headers),
                    credentials=credentials,
                    policy=server_config.policy,
                )
            )
        return resolved
