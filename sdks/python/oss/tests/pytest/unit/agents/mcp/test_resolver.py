from __future__ import annotations

from typing import Mapping, Sequence

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.mcp import (
    MCPConnection,
    MCPHeaderSecretRefs,
    MCPPolicy,
    MCPResolver,
    MCPServerConfig,
    MCPToolPolicy,
    MissingMCPSecretError,
)
from agenta.sdk.agents.tools import MissingSecretPolicy


class DictSecretProvider:
    def __init__(self, values: Mapping[str, str]):
        self.values = values

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {name: self.values[name] for name in names if name in self.values}


def server(**overrides) -> MCPServerConfig:
    values = {
        "name": "memory",
        "connection": {"type": "http", "url": "https://memory.example.com/mcp"},
    }
    values.update(overrides)
    return MCPServerConfig.model_validate(values)


def test_connection_is_required_and_legacy_flat_shape_is_rejected():
    with pytest.raises(ValidationError, match="connection"):
        MCPServerConfig(name="memory")
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        MCPServerConfig.model_validate(
            {
                "name": "legacy",
                "transport": "stdio",
                "command": "npx",
                "connection": {"type": "http", "url": "https://example.com/mcp"},
            }
        )


@pytest.mark.parametrize("name", ["has spaces", "slash/name", ""])
def test_server_name_must_be_a_runtime_safe_identifier(name):
    with pytest.raises(ValidationError, match="name"):
        server(name=name)


async def test_resolves_public_and_secret_headers():
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({"memory_token": "secret-value"})
    ).resolve(
        [
            server(
                connection=MCPConnection(
                    type="http",
                    url="https://memory.example.com/mcp",
                    headers={"X-Workspace": "demo"},
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "memory_token"}
                    ),
                )
            )
        ]
    )
    assert resolved[0].to_wire()["connection"] == {
        "type": "http",
        "url": "https://memory.example.com/mcp",
        "headers": {
            "X-Workspace": "demo",
            "Authorization": "secret-value",
        },
    }


async def test_missing_mcp_secret_is_explicit():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                server(
                    connection=MCPConnection(
                        type="http",
                        url="https://memory.example.com/mcp",
                        credentials=MCPHeaderSecretRefs(
                            headers={"Authorization": "missing"}
                        ),
                    )
                )
            ]
        )


async def test_policy_rides_the_wire():
    resolved = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [
            server(
                policy=MCPPolicy(
                    tools=MCPToolPolicy(mode="include", names=["search"]),
                    permission="ask",
                )
            )
        ]
    )
    assert resolved[0].to_wire()["policy"] == {
        "tools": {"mode": "include", "names": ["search"]},
        "permission": "ask",
    }


async def test_default_policy_is_explicit_all():
    resolved = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [server()]
    )
    assert resolved[0].to_wire()["policy"] == {"tools": {"mode": "all"}}


def test_tool_policy_rejects_ambiguous_combinations():
    with pytest.raises(ValidationError, match="must not declare names"):
        MCPToolPolicy(mode="all", names=["search"])
    with pytest.raises(ValidationError, match="requires names"):
        MCPToolPolicy(mode="include")


async def test_omit_missing_secret_keeps_public_headers_only():
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        missing_secret_policy=MissingSecretPolicy.OMIT,
    ).resolve(
        [
            server(
                connection=MCPConnection(
                    type="http",
                    url="https://memory.example.com/mcp",
                    headers={"X-Workspace": "demo"},
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "missing"}
                    ),
                )
            )
        ]
    )
    assert resolved[0].to_wire()["connection"]["headers"] == {"X-Workspace": "demo"}
