from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    CodeToolSpec,
    MissingMCPSecretError,
    MissingToolSecretError,
)

from oss.src.agent.tools import resolve_mcp_servers, resolve_tools
from oss.src.agent.tools import resolver as resolver_module
from oss.src.agent.tools import secrets as secrets_module


async def test_resolve_tools_builds_local_specs_with_scoped_secrets(monkeypatch):
    async def _named_secrets(names):
        assert names == ["TOKEN"]
        return {"TOKEN": "secret"}

    monkeypatch.setattr(secrets_module, "resolve_named_secrets", _named_secrets)
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
        ]
    )
    assert resolved.builtin_names == ["read"]
    code = next(spec for spec in resolved.tool_specs if spec.name == "calc")
    assert isinstance(code, CodeToolSpec)
    assert code.env == {"TOKEN": "secret"}
    assert (
        next(spec for spec in resolved.tool_specs if spec.name == "pick").kind
        == "client"
    )


async def test_missing_tool_secret_is_not_silently_omitted(monkeypatch):
    async def _named_secrets(_names):
        return {}

    monkeypatch.setattr(secrets_module, "resolve_named_secrets", _named_secrets)
    with pytest.raises(MissingToolSecretError):
        await resolve_tools(
            [
                {
                    "type": "code",
                    "name": "calc",
                    "script": "...",
                    "secrets": ["TOKEN"],
                }
            ]
        )


async def test_mcp_is_disabled_at_service_composition_by_default(monkeypatch):
    monkeypatch.delenv("AGENTA_AGENT_ENABLE_MCP", raising=False)
    assert await resolve_mcp_servers([{"name": "github", "command": "npx"}]) == []


async def test_missing_mcp_secret_is_explicit_when_enabled(monkeypatch):
    monkeypatch.setattr(resolver_module, "_mcp_enabled", lambda: True)

    async def _named_secrets(_names):
        return {}

    monkeypatch.setattr(secrets_module, "resolve_named_secrets", _named_secrets)
    with pytest.raises(MissingMCPSecretError):
        await resolve_mcp_servers(
            [
                {
                    "name": "github",
                    "command": "npx",
                    "secrets": {"GITHUB_TOKEN": "missing"},
                }
            ]
        )
