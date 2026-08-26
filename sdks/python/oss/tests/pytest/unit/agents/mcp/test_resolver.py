from __future__ import annotations

from typing import Mapping, Sequence

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.mcp import (
    MCPConnection,
    MCPGatewayConnection,
    MCPGatewayUnavailableError,
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


_GATEWAY_BASE = "https://api.x/api"


def _gateway_route(name: str) -> str:
    return f"{_GATEWAY_BASE}/gateways/mcps/custom/{name}"


async def test_gateway_routes_through_custom_namespace_with_our_credentials():
    # Every author-declared server is a custom target: the resolved URL is the
    # gateway route, and the sole credential is OUR own (X-AG-Credentials), never the
    # upstream secret the author's `credentials` refs named.
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({"memory_token": "upstream-secret"}),
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value="Access tok",
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
    assert resolved[0].to_wire()["connection"] == {
        "type": "http",
        "url": _gateway_route("memory"),
        "headers": {"X-Workspace": "demo"},
        "credentials": [
            {
                "binding": {"kind": "header", "name": "X-AG-Credentials"},
                "value": "Access tok",
                "usage": "opaque_http",
            }
        ],
    }
    assert "upstream-secret" not in repr(resolved[0])
    assert "upstream-secret" not in resolved[0].model_dump_json()
    assert "Access tok" not in resolved[0].model_dump_json()


@pytest.mark.parametrize(
    ("connection", "expected_route"),
    [
        (
            MCPGatewayConnection(namespace="builtin", provider="mock"),
            f"{_GATEWAY_BASE}/gateways/mcps/builtin/mock/mock",
        ),
        (
            MCPGatewayConnection(namespace="standard", provider="mock"),
            f"{_GATEWAY_BASE}/gateways/mcps/standard/mock",
        ),
        (
            MCPGatewayConnection(namespace="custom", slug="mock-custom"),
            f"{_GATEWAY_BASE}/gateways/mcps/custom/mock-custom",
        ),
    ],
)
async def test_gateway_connection_selects_each_public_mcp_namespace(
    connection, expected_route
):
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value="Access tok",
    ).resolve([server(name="mock-mcp", connection=connection)])

    assert resolved[0].url == expected_route
    assert resolved[0].headers == {}
    assert [credential.binding.name for credential in resolved[0].credentials] == [
        "X-AG-Credentials"
    ]


@pytest.mark.parametrize(
    "connection",
    [
        {"type": "gateway", "namespace": "builtin"},
        {"type": "gateway", "namespace": "standard", "provider": "mock", "slug": "x"},
        {"type": "gateway", "namespace": "custom", "provider": "mock"},
    ],
)
def test_gateway_connection_requires_one_unambiguous_route_identity(connection):
    with pytest.raises(ValidationError):
        server(connection=connection)


async def test_gateway_connection_requires_platform_connection():
    with pytest.raises(MCPGatewayUnavailableError, match="gateway connection"):
        await MCPResolver(secret_provider=DictSecretProvider({})).resolve(
            [
                server(
                    connection=MCPGatewayConnection(
                        namespace="builtin", provider="mock"
                    )
                )
            ]
        )


async def test_gateway_collapses_every_servers_array_to_one_credential_each():
    # CU6: N servers, each with its own author-declared secret refs, still resolve to
    # exactly one gateway credential PER server -- the per-server array shrinks to one
    # entry everywhere, not just when there is a single server to resolve.
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value="Access tok",
    ).resolve(
        [
            server(
                name="memory",
                connection=MCPConnection(
                    type="http",
                    url=PUBLIC_MCP_URL,
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "memory_token"}
                    ),
                ),
            ),
            server(
                name="notion",
                connection=MCPConnection(
                    type="http",
                    url=PUBLIC_MCP_URL,
                    credentials=MCPHeaderSecretRefs(
                        headers={
                            "Authorization": "notion_token",
                            "X-Api-Key": "notion_key",
                        }
                    ),
                ),
            ),
        ]
    )
    assert [server_.name for server_ in resolved] == ["memory", "notion"]
    for server_, name in zip(resolved, ["memory", "notion"]):
        assert server_.url == _gateway_route(name)
        assert [c.binding.name for c in server_.credentials] == ["X-AG-Credentials"]
        assert [c.value for c in server_.credentials] == ["Access tok"]


async def test_gateway_route_ignores_the_authors_url_and_needs_no_secret_lookup():
    # The upstream secret is the gateway's problem now (its own stored endpoint holds it),
    # so a missing named secret never blocks resolution once a gateway is configured.
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value="Access tok",
    ).resolve(
        [
            server(
                name="notion",
                connection=MCPConnection(
                    type="http",
                    url="http://169.254.169.254/latest/meta-data/",  # would fail the SSRF guard
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "missing-secret"}
                    ),
                ),
            )
        ]
    )
    assert resolved[0].url == _gateway_route("notion")


async def test_gateway_route_passes_policy_through_unchanged():
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({}),
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value="Access tok",
    ).resolve(
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


async def test_no_gateway_configured_falls_back_to_direct_dial():
    # Backward compatible: the offline/standalone case (no gateway args) is untouched.
    resolved = await MCPResolver(
        secret_provider=DictSecretProvider({"memory_token": "secret-value"})
    ).resolve(
        [
            server(
                connection=MCPConnection(
                    type="http",
                    url=PUBLIC_MCP_URL,
                    credentials=MCPHeaderSecretRefs(
                        headers={"Authorization": "memory_token"}
                    ),
                )
            )
        ]
    )
    assert resolved[0].url == PUBLIC_MCP_URL
    assert resolved[0].to_wire()["connection"]["credentials"] == [
        {
            "binding": {"kind": "header", "name": "Authorization"},
            "value": "secret-value",
            "usage": "opaque_http",
        }
    ]


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
