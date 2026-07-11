from __future__ import annotations

from typing import Mapping, Sequence

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.mcp import (
    MCPConfigurationError,
    MCPResolver,
    MCPServerConfig,
    MissingMCPSecretError,
)
from agenta.sdk.agents.tools import MissingSecretPolicy


class DictSecretProvider:
    def __init__(self, values: Mapping[str, str]):
        self.values = values

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {name: self.values[name] for name in names if name in self.values}


def test_transport_specific_fields_and_roles_are_validated():
    with pytest.raises(ValidationError, match="requires command"):
        MCPServerConfig(name="stdio")
    with pytest.raises(ValidationError, match="requires url"):
        MCPServerConfig(name="remote", transport="http")
    with pytest.raises(ValidationError, match="absolute HTTPS"):
        MCPServerConfig(name="remote", transport="http", url="http://example.com")
    with pytest.raises(ValidationError, match="environment is invalid"):
        MCPServerConfig(
            name="remote",
            transport="http",
            url="https://example.com",
            env={"LOG": "info"},
        )
    with pytest.raises(ValidationError, match="header credentials are unsupported"):
        MCPServerConfig(name="stdio", command="npx", secrets={"Authorization": "token"})


async def test_resolves_stdio_non_secret_process_environment():
    servers = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [MCPServerConfig(name="github", command="npx", env={"LOG": "info"})]
    )
    assert servers[0].to_wire()["environment"] == {"LOG": "info"}
    assert "credentials" not in servers[0].to_wire()


async def test_resolves_http_public_headers_and_typed_secret_credentials():
    servers = await MCPResolver(
        secret_provider=DictSecretProvider({"linear_token": "Bearer secret-value"})
    ).resolve(
        [
            MCPServerConfig(
                name="linear",
                transport="http",
                url="https://93.184.216.34:8443/mcp",
                headers={"X-Client": "agenta"},
                secrets={"Authorization": "linear_token"},
            )
        ]
    )
    assert servers[0].to_wire() == {
        "name": "linear",
        "transport": "http",
        "url": "https://93.184.216.34:8443/mcp",
        "headers": {"X-Client": "agenta"},
        "credentials": [
            {
                "binding": {"kind": "header", "name": "Authorization"},
                "value": "Bearer secret-value",
                "usage": "opaque_http",
            }
        ],
    }
    assert "secret-value" not in repr(servers[0])


async def test_missing_http_mcp_secret_is_explicit():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                MCPServerConfig(
                    name="linear",
                    transport="http",
                    url="https://93.184.216.34/mcp",
                    secrets={"Authorization": "missing"},
                )
            ]
        )


async def test_empty_secret_value_is_treated_as_missing():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({"token": ""})).resolve(
            [
                MCPServerConfig(
                    name="linear",
                    transport="http",
                    url="https://93.184.216.34/mcp",
                    secrets={"Authorization": "token"},
                )
            ]
        )


async def test_unsafe_http_mcp_url_is_a_configuration_error():
    with pytest.raises(MCPConfigurationError, match="unsafe url"):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                MCPServerConfig(
                    name="internal", transport="http", url="https://127.0.0.1/mcp"
                )
            ]
        )


async def test_permission_rides_the_wire_when_set():
    servers = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [MCPServerConfig(name="github", command="npx", permission="ask")]
    )
    assert servers[0].permission == "ask"
    assert servers[0].to_wire()["permission"] == "ask"


async def test_permission_absent_from_wire_when_unset():
    servers = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [MCPServerConfig(name="github", command="npx")]
    )
    assert servers[0].permission is None
    assert "permission" not in servers[0].to_wire()


def test_legacy_permission_mode_alias_is_ignored():
    config = MCPServerConfig.model_validate(
        {"name": "github", "command": "npx", "permission_mode": "deny"}
    )
    assert config.permission is None


async def test_mcp_compatibility_policy_can_omit_missing_http_secret():
    servers = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        missing_secret_policy=MissingSecretPolicy.OMIT,
    ).resolve(
        [
            MCPServerConfig(
                name="linear",
                transport="http",
                url="https://93.184.216.34/mcp",
                secrets={"Authorization": "missing"},
            )
        ]
    )
    assert "credentials" not in servers[0].to_wire()
