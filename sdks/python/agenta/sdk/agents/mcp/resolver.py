"""Resolution of MCP server declarations into runner configuration."""

from __future__ import annotations

from typing import Mapping, Sequence

from agenta.sdk.agents.tools.models import MissingSecretPolicy

from .errors import MissingMCPSecretError
from .interfaces import MCPSecretProvider
from .models import MCPHeaderSecretRefs, MCPServerConfig, ResolvedMCPServer


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
            missing = [
                secret_name
                for secret_name in secret_refs.values()
                if secret_name not in secret_values
            ]
            if missing and self._missing_secret_policy == MissingSecretPolicy.ERROR:
                raise MissingMCPSecretError(
                    server_name=server_config.name,
                    secret_names=missing,
                )

            headers = dict(server_config.connection.headers)
            for header_name, secret_name in secret_refs.items():
                if secret_name in secret_values:
                    headers[header_name] = secret_values[secret_name]

            resolved.append(
                ResolvedMCPServer(
                    name=server_config.name,
                    url=server_config.connection.url,
                    headers=headers,
                    policy=server_config.policy,
                )
            )
        return resolved
