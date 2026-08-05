"""Resolution of MCP server declarations into runner configuration."""

from __future__ import annotations

from typing import Mapping, Sequence

from agenta.sdk.agents.tools.models import MissingSecretPolicy
from agenta.sdk.utils.net import assert_endpoint_url_allowed

from .errors import MCPServerURLBlockedError, MissingMCPSecretError
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
