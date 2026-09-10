from unittest.mock import AsyncMock

import pytest

from agenta.sdk.agents.connections import ResolvedConnection
from agenta.sdk.agents.dtos import SandboxCredentialConfig
from agenta.sdk.agents.sandbox_credentials import (
    RESERVED_SANDBOX_ENVIRONMENT_NAMES,
    SandboxCredentialError,
    resolve_sandbox_credentials,
)


def credential(slug="github-token", name="GITHUB_TOKEN"):
    return SandboxCredentialConfig.model_validate(
        {"secret": {"slug": slug}, "binding": {"type": "env", "name": name}}
    )


async def test_resolves_references_to_environment_wire_credentials():
    resolver = AsyncMock(return_value={"github-token": "  token value  "})
    result = await resolve_sandbox_credentials([credential()], resolver=resolver)
    assert result[0].to_wire() == {
        "binding": {"kind": "environment", "name": "GITHUB_TOKEN"},
        "value": "  token value  ",
    }
    resolver.assert_awaited_once_with(["github-token"])


@pytest.mark.parametrize("name", ["9TOKEN", "BAD-NAME", "A B", ""])
async def test_rejects_invalid_environment_names(name):
    with pytest.raises(SandboxCredentialError):
        await resolve_sandbox_credentials([credential(name=name)], resolver=AsyncMock())


@pytest.mark.parametrize("name", sorted(RESERVED_SANDBOX_ENVIRONMENT_NAMES))
async def test_rejects_reserved_environment_names(name):
    with pytest.raises(SandboxCredentialError):
        await resolve_sandbox_credentials([credential(name=name)], resolver=AsyncMock())


async def test_resolution_is_all_or_nothing():
    resolver = AsyncMock(return_value={"one": "value"})
    with pytest.raises(SandboxCredentialError, match="1 configured"):
        await resolve_sandbox_credentials(
            [credential("one", "ONE"), credential("two", "TWO")], resolver=resolver
        )


async def test_rejects_duplicate_bindings_before_vault_read():
    resolver = AsyncMock()
    with pytest.raises(SandboxCredentialError, match="duplicate"):
        await resolve_sandbox_credentials(
            [credential("one", "TOKEN"), credential("two", "TOKEN")], resolver=resolver
        )
    resolver.assert_not_awaited()


async def test_rejects_collision_with_model_owned_environment():
    connection = ResolvedConnection(
        provider="openai",
        model="gpt",
        credential_mode="none",
        environment={"GITHUB_TOKEN": "public-config"},
    )
    with pytest.raises(SandboxCredentialError, match="already owned"):
        await resolve_sandbox_credentials(
            [credential()], resolved_connection=connection, resolver=AsyncMock()
        )


@pytest.mark.parametrize(
    "name",
    ["AGENTA_AGENT_FUTURE_CONTROL", "SANDBOX_AGENT_COMMAND", "PI_CODING_AGENT_FUTURE"],
)
async def test_rejects_runner_control_prefixes(name):
    with pytest.raises(SandboxCredentialError, match="reserved by the runtime"):
        await resolve_sandbox_credentials([credential(name=name)], resolver=AsyncMock())


async def test_does_not_treat_mcp_http_headers_as_environment_collisions():
    from agenta.sdk.agents.mcp import MCPPolicy, ResolvedMCPServer

    server = ResolvedMCPServer(
        name="server",
        url="https://example.com/mcp",
        headers={"Authorization": "public"},
        policy=MCPPolicy(),
    )
    resolver = AsyncMock(return_value={"github-token": "secret"})
    resolved = await resolve_sandbox_credentials(
        [credential(name="Authorization")],
        mcp_servers=[server],
        resolver=resolver,
    )
    assert resolved[0].binding.name == "Authorization"
