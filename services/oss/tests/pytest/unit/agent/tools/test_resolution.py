from __future__ import annotations

from typing import Mapping, Sequence

import pytest

from agenta.sdk.agents import (
    CodeToolSpec,
    MCPDisabledError,
    MissingMCPSecretError,
    MissingToolSecretError,
)

from oss.src.agent.tools import resolve_mcp_servers, resolve_tools
from oss.src.agent.tools import resolver as resolver_module


class _FakeSecretProvider:
    """A `ToolSecretProvider` that serves canned values and records the names requested."""

    def __init__(self, values: Mapping[str, str]) -> None:
        self.values = dict(values)
        self.requests: list[list[str]] = []

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        self.requests.append(list(names))
        return {name: self.values[name] for name in names if name in self.values}


async def test_resolve_tools_builds_local_specs_with_scoped_secrets():
    provider = _FakeSecretProvider({"TOKEN": "secret"})
    resolved = await resolve_tools(
        [
            "read",
            {
                "type": "code",
                "name": "calc",
                "script": "...",
                "secrets": ["TOKEN"],
            },
            {
                "type": "client",
                "name": "pick",
            },
        ],
        secret_provider=provider,
    )
    assert provider.requests == [["TOKEN"]]
    assert resolved.builtin_names == ["read"]
    code = next(spec for spec in resolved.tool_specs if spec.name == "calc")
    assert isinstance(code, CodeToolSpec)
    assert code.env == {"TOKEN": "secret"}
    assert (
        next(spec for spec in resolved.tool_specs if spec.name == "pick").kind
        == "client"
    )


async def test_missing_tool_secret_is_not_silently_omitted():
    with pytest.raises(MissingToolSecretError):
        await resolve_tools(
            [
                {
                    "type": "code",
                    "name": "calc",
                    "script": "...",
                    "secrets": ["TOKEN"],
                }
            ],
            secret_provider=_FakeSecretProvider({}),
        )


async def test_mcp_disabled_with_no_servers_is_an_empty_list(monkeypatch):
    # The common case (MCP off, no servers declared): still a clean empty list, unchanged.
    monkeypatch.delenv("AGENTA_AGENT_MCPS_ENABLED", raising=False)
    assert await resolve_mcp_servers([]) == []


async def test_mcp_disabled_with_servers_fails_loud_instead_of_silent_strip(
    monkeypatch,
):
    # F-039: disabling MCP must NOT silently drop user-declared servers. The user gets a clear
    # "MCP servers are disabled" error naming the servers, not a run that quietly ignored them.
    monkeypatch.delenv("AGENTA_AGENT_MCPS_ENABLED", raising=False)
    with pytest.raises(MCPDisabledError) as excinfo:
        await resolve_mcp_servers(
            [
                {"name": "github", "command": "npx"},
                {"name": "filesystem", "command": "npx"},
            ]
        )
    assert excinfo.value.server_names == ("github", "filesystem")
    message = str(excinfo.value)
    assert "disabled" in message
    assert "github" in message and "filesystem" in message


async def test_missing_mcp_secret_is_explicit_when_enabled(monkeypatch):
    monkeypatch.setattr(resolver_module, "_mcp_enabled", lambda: True)
    with pytest.raises(MissingMCPSecretError):
        await resolve_mcp_servers(
            [
                {
                    "name": "github",
                    "command": "npx",
                    "secrets": {"GITHUB_TOKEN": "missing"},
                }
            ],
            secret_provider=_FakeSecretProvider({}),
        )
