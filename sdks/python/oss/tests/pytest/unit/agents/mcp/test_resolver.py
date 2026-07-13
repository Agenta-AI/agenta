from __future__ import annotations

from typing import Mapping, Sequence

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.mcp import (
    MCPResolver,
    MCPServerConfig,
    MCPServerURLBlockedError,
    MissingMCPSecretError,
)
from agenta.sdk.agents.tools import MissingSecretPolicy


class DictSecretProvider:
    def __init__(self, values: Mapping[str, str]):
        self.values = values

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {name: self.values[name] for name in names if name in self.values}


def test_transport_specific_fields_are_required():
    with pytest.raises(ValidationError, match="requires command"):
        MCPServerConfig(name="stdio")
    with pytest.raises(ValidationError, match="requires url"):
        MCPServerConfig(name="remote", transport="http")


async def test_resolves_mcp_environment_in_sibling_subsystem():
    servers = await MCPResolver(
        secret_provider=DictSecretProvider({"github_pat": "ghp"})
    ).resolve(
        [
            MCPServerConfig(
                name="github",
                command="npx",
                env={"LOG": "info"},
                secrets={"GITHUB_TOKEN": "github_pat"},
            )
        ]
    )
    assert servers[0].to_wire()["env"] == {
        "LOG": "info",
        "GITHUB_TOKEN": "ghp",
    }


async def test_missing_mcp_secret_is_explicit():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                MCPServerConfig(
                    name="github",
                    command="npx",
                    secrets={"GITHUB_TOKEN": "missing"},
                )
            ]
        )


async def test_permission_rides_the_wire_when_set():
    # An author's per-server permission is carried onto the resolved server and serialized.
    servers = await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
        [MCPServerConfig(name="github", command="npx", permission="ask")]
    )
    assert servers[0].permission == "ask"
    assert servers[0].to_wire()["permission"] == "ask"


async def test_permission_absent_from_wire_when_unset():
    # No permission declared -> no `permission` key (a server has no read_only to default from).
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


async def test_http_server_url_blocked_by_ssrf_guard():
    with pytest.raises(MCPServerURLBlockedError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                MCPServerConfig(
                    name="internal",
                    transport="http",
                    url="http://169.254.169.254/latest/meta-data/",
                )
            ]
        )


async def test_mcp_compatibility_policy_can_omit_missing_secret():
    servers = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        missing_secret_policy=MissingSecretPolicy.OMIT,
    ).resolve(
        [
            MCPServerConfig(
                name="github",
                command="npx",
                secrets={"GITHUB_TOKEN": "missing"},
            )
        ]
    )
    assert "env" not in servers[0].to_wire()
