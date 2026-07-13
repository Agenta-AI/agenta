"""Resolution of MCP server declarations into runner configuration."""

from __future__ import annotations

from typing import Mapping, Sequence

from agenta.sdk.agents.tools.models import MissingSecretPolicy
from agenta.sdk.utils.net import assert_endpoint_url_allowed

from .errors import MCPConfigurationError, MissingMCPSecretError
from .interfaces import MCPSecretProvider
from .models import MCPServerConfig, ResolvedMCPServer


class MCPResolver:
    def __init__(
        self,
        *,
        secret_provider: MCPSecretProvider,
        missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    ) -> None:
        self._secret_provider = secret_provider
        self._missing_secret_policy = missing_secret_policy

    async def resolve(
        self,
        server_configs: Sequence[MCPServerConfig],
    ) -> list[ResolvedMCPServer]:
        secret_names = sorted(
            {
                secret_name
                for server_config in server_configs
                for secret_name in server_config.secrets.values()
            }
        )
        secret_values: Mapping[str, str] = (
            await self._secret_provider.get_many(secret_names) if secret_names else {}
        )

        resolved: list[ResolvedMCPServer] = []
        for server_config in server_configs:
            missing = [
                secret_name
                for secret_name in server_config.secrets.values()
                if not secret_values.get(secret_name)
            ]
            if missing and self._missing_secret_policy == MissingSecretPolicy.ERROR:
                raise MissingMCPSecretError(
                    server_name=server_config.name,
                    secret_names=missing,
                )

            if server_config.transport == "http":
                try:
                    assert_endpoint_url_allowed(server_config.url or "")
                except ValueError as exc:
                    raise MCPConfigurationError(
                        f"HTTP MCP server '{server_config.name}' has an unsafe url: {exc}"
                    ) from exc

            credentials = [
                {
                    "binding": {"kind": "header", "name": header_name},
                    "value": secret_values[secret_name],
                    "usage": "opaque_http",
                }
                for header_name, secret_name in server_config.secrets.items()
                if secret_values.get(secret_name)
            ]

            resolved.append(
                ResolvedMCPServer(
                    name=server_config.name,
                    transport=server_config.transport,
                    command=server_config.command,
                    args=list(server_config.args),
                    environment=dict(server_config.env),
                    url=server_config.url,
                    headers=dict(server_config.headers),
                    credentials=credentials,
                    tools=list(server_config.tools),
                    permission=server_config.permission,
                )
            )
        return resolved
