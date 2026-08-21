"""The ``gateway_toolkit`` per-connection tool: config contract + resolver wrapping.

One ``gateway_toolkit`` config resolves into TWO callback specs — a search tool and a run
tool. Resolution is server-side: the backend maps the connection slug to its id, keys both
``call_ref`` values on that id, and encodes the policy. These tests cover the config contract
(parse, the include/all guards, the default permission) and the SDK resolver wrapping the two
specs the backend returns.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.tools import (
    GatewayToolkitConfig,
    ToolkitPolicy,
    coerce_tool_config,
)
from agenta.sdk.agents.platform import AgentaGatewayToolResolver, PlatformConnection
from agenta.sdk.agents.platform import gateway


# ---------------------------------------------------------------------------
# Config contract
# ---------------------------------------------------------------------------


def test_gateway_toolkit_config_parses_and_defaults():
    config = coerce_tool_config(
        {
            "type": "gateway_toolkit",
            "integration": "github",
            "connection": "github-main",
        }
    )
    assert isinstance(config, GatewayToolkitConfig)
    assert config.provider == "composio"  # default
    assert config.tools.mode == "all"  # default
    assert config.tools.actions is None
    assert config.permission == "ask"  # default: human-in-the-loop


def test_gateway_toolkit_config_parses_include_policy_and_permission():
    config = coerce_tool_config(
        {
            "type": "gateway_toolkit",
            "integration": "github",
            "connection": "github-main",
            "tools": {"mode": "include", "actions": ["CREATE_AN_ISSUE"]},
            "permission": "allow",
        }
    )
    assert config.tools.mode == "include"
    assert config.tools.actions == ["CREATE_AN_ISSUE"]  # Agenta action keys, not slugs
    assert config.permission == "allow"


def test_include_policy_requires_actions():
    with pytest.raises(ValidationError):
        ToolkitPolicy(mode="include")


def test_all_policy_rejects_actions():
    with pytest.raises(ValidationError):
        ToolkitPolicy(mode="all", actions=["GET_ISSUE"])


def test_action_key_charset_is_validated():
    with pytest.raises(ValidationError):
        ToolkitPolicy(mode="include", actions=["bad.key.with.dots"])


def test_old_per_action_gateway_type_still_parses():
    # The new discriminator must not disturb the existing per-action config.
    config = coerce_tool_config(
        {
            "type": "gateway",
            "integration": "github",
            "action": "GET_USER",
            "connection": "github-main",
        }
    )
    assert config.type == "gateway"


# ---------------------------------------------------------------------------
# Resolver: wraps the two specs the backend returns
# ---------------------------------------------------------------------------


async def test_resolve_toolkit_posts_config_and_wraps_specs(fake_http, connection):
    # The backend keys both call_refs on the connection id and encodes the policy; the SDK
    # posts the config and wraps whatever specs come back (two per config, not one).
    capture = fake_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "github_github_main_search",
                    "description": "Search github actions",
                    "input_schema": {"type": "object"},
                    "call_ref": "toolkit.composio.11111111-1111-1111-1111-111111111111.search",
                    "read_only": True,
                    "permission": "ask",
                },
                {
                    "name": "github_github_main_run",
                    "description": "Run one github action",
                    "input_schema": {"type": "object"},
                    "call_ref": (
                        "toolkit.composio.11111111-1111-1111-1111-111111111111."
                        "run.include.GITHUB_CREATE_AN_ISSUE"
                    ),
                    "permission": "ask",
                },
            ]
        },
    )

    config = GatewayToolkitConfig(
        integration="github",
        connection="github-main",
        tools=ToolkitPolicy(mode="include", actions=["CREATE_AN_ISSUE"]),
    )
    resolution = await AgentaGatewayToolResolver(connection=connection).resolve_toolkit(
        [config]
    )

    # The whole config rode to /tools/resolve so the backend can map slug -> id.
    assert capture["url"] == "https://api.x/api/tools/resolve"
    assert capture["json"]["tools"][0]["type"] == "gateway_toolkit"
    assert capture["json"]["tools"][0]["connection"] == "github-main"

    assert len(resolution.tool_specs) == 2
    search, run = resolution.tool_specs
    assert search.name == "github_github_main_search"
    assert search.call_ref.endswith(".search")
    assert search.permission == "ask"
    assert run.name == "github_github_main_run"
    assert ".run.include.GITHUB_CREATE_AN_ISSUE" in run.call_ref
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolution.tool_callback.authorization == "Access tok"


async def test_resolve_toolkit_requires_api_base():
    from agenta.sdk.agents.tools import GatewayToolResolutionError

    resolver = AgentaGatewayToolResolver(connection=PlatformConnection())
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve_toolkit(
            [GatewayToolkitConfig(integration="github", connection="github-main")]
        )


async def test_tool_resolver_routes_toolkit_config_to_two_specs():
    """A ``gateway_toolkit`` config flows through the top-level ToolResolver as two specs."""
    from typing import Sequence

    from agenta.sdk.agents.tools import (
        CallbackToolSpec,
        GatewayToolResolution,
        ToolCallback,
        ToolResolver,
    )

    class FakeResolver:
        async def resolve_toolkit(
            self, tools: Sequence[GatewayToolkitConfig]
        ) -> GatewayToolResolution:
            specs = []
            for tool in tools:
                specs.append(
                    CallbackToolSpec(
                        name=f"{tool.integration}_search",
                        description="search",
                        call_ref="a",
                    )
                )
                specs.append(
                    CallbackToolSpec(
                        name=f"{tool.integration}_run",
                        description="run",
                        call_ref="b",
                    )
                )
            return GatewayToolResolution(
                tool_specs=specs,
                tool_callback=ToolCallback(endpoint="https://example/tools/call"),
            )

    resolver = ToolResolver(gateway_resolver=FakeResolver())
    resolved = await resolver.resolve(
        [GatewayToolkitConfig(integration="github", connection="github-main")]
    )
    names = {spec.name for spec in resolved.tool_specs}
    assert names == {"github_search", "github_run"}
    assert resolved.tool_callback.endpoint == "https://example/tools/call"
