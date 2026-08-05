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
    MCPServerURLBlockedError,
    MCPToolPolicy,
    MissingMCPSecretError,
)
from agenta.sdk.agents.tools import MissingSecretPolicy


class DictSecretProvider:
    def __init__(self, values: Mapping[str, str]):
        self.values = values

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {name: self.values[name] for name in names if name in self.values}


# Literal public IP (example.com's) so the SSRF guard's range check runs with no live DNS.
PUBLIC_MCP_URL = "https://93.184.216.34/mcp"


def server(**overrides) -> MCPServerConfig:
    values = {
        "name": "memory",
        "connection": {"type": "http", "url": PUBLIC_MCP_URL},
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


def test_public_and_secret_header_names_must_be_unique():
    # One header name cannot be both a public value and a secret credential.
    with pytest.raises(ValidationError, match="must be unique"):
        MCPConnection(
            type="http",
            url=PUBLIC_MCP_URL,
            headers={"Authorization": "public"},
            credentials=MCPHeaderSecretRefs(headers={"authorization": "token_ref"}),
        )


async def test_resolves_public_headers_and_typed_secret_credentials():
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({"memory_token": "secret-value"})
    ).resolve(
        [
            server(
                connection=MCPConnection(
                    type="http",
                    url=PUBLIC_MCP_URL,
                    headers={"X-Workspace": "demo"},
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "memory_token"}
                    ),
                )
            )
        ]
    )
    # Public headers and secret credentials stay separate by protocol role: the resolved
    # secret rides a typed header binding, never a merged header value.
    assert resolved[0].to_wire()["connection"] == {
        "type": "http",
        "url": PUBLIC_MCP_URL,
        "headers": {"X-Workspace": "demo"},
        "credentials": [
            {
                "binding": {"kind": "header", "name": "Authorization"},
                "value": "secret-value",
                "usage": "opaque_http",
            }
        ],
    }
    assert "secret-value" not in repr(resolved[0])
    # Structural dump guard (F-SDK-DUMP), mirroring ResolvedCredential: a model_dump can never
    # carry the credential value — only to_wire/attribute access hands it to the runner wire.
    assert "secret-value" not in str(resolved[0].model_dump())
    assert "secret-value" not in resolved[0].model_dump_json()
    dumped = resolved[0].model_dump()
    assert dumped["credentials"][0]["value"] == "**********"


async def test_missing_http_mcp_secret_is_explicit():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                server(
                    connection=MCPConnection(
                        type="http",
                        url=PUBLIC_MCP_URL,
                        credentials=MCPHeaderSecretRefs(
                            headers={"Authorization": "missing"}
                        ),
                    )
                )
            ]
        )


async def test_empty_secret_value_is_treated_as_missing():
    with pytest.raises(MissingMCPSecretError):
        await MCPResolver(secret_provider=DictSecretProvider({"token": ""})).resolve(
            [
                server(
                    connection=MCPConnection(
                        type="http",
                        url=PUBLIC_MCP_URL,
                        credentials=MCPHeaderSecretRefs(
                            headers={"Authorization": "token"}
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


async def test_http_server_url_blocked_by_ssrf_guard():
    with pytest.raises(MCPServerURLBlockedError):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                server(
                    connection=MCPConnection(
                        type="http",
                        url="http://169.254.169.254/latest/meta-data/",
                    )
                )
            ]
        )


async def test_omit_missing_secret_keeps_public_headers_only():
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        missing_secret_policy=MissingSecretPolicy.OMIT,
    ).resolve(
        [
            server(
                connection=MCPConnection(
                    type="http",
                    url=PUBLIC_MCP_URL,
                    headers={"X-Workspace": "demo"},
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "missing"}
                    ),
                )
            )
        ]
    )
    assert resolved[0].to_wire()["connection"]["headers"] == {"X-Workspace": "demo"}
    assert "credentials" not in resolved[0].to_wire()["connection"]
