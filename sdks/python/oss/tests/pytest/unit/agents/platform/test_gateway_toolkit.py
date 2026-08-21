"""The ``gateway_toolkit`` per-connection tool: config parsing + local spec synthesis.

One ``gateway_toolkit`` config resolves into TWO callback specs — a search tool and a run
tool — with no per-action provider call at resolve time. These tests cover the config
contract (parse, the include/all guards) and the resolver output (two specs, stable
call_refs, the policy carried on the run call_ref).
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


# ---------------------------------------------------------------------------
# Config contract
# ---------------------------------------------------------------------------


def test_gateway_toolkit_config_parses_and_defaults_to_all():
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
    # Short Agenta action keys are stored; the run call_ref maps them to Composio slugs.
    assert config.tools.actions == ["CREATE_AN_ISSUE"]
    assert config.allowed_slugs == ["GITHUB_CREATE_AN_ISSUE"]
    assert config.permission == "allow"


def test_include_policy_requires_actions():
    with pytest.raises(ValidationError):
        ToolkitPolicy(mode="include")


def test_all_policy_rejects_actions():
    with pytest.raises(ValidationError):
        ToolkitPolicy(mode="all", actions=["GITHUB_GET_ISSUE"])


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
# call_ref grammar
# ---------------------------------------------------------------------------


def test_call_refs_encode_routing_and_mapped_policy():
    # Short action keys in the config; the run call_ref carries the full Composio slugs.
    config = GatewayToolkitConfig(
        integration="github",
        connection="github-main",
        tools=ToolkitPolicy(mode="include", actions=["CREATE_AN_ISSUE", "GET_ISSUE"]),
    )
    assert config.search_call_ref == "toolkit.composio.github.github-main.search"
    assert config.run_call_ref == (
        "toolkit.composio.github.github-main.run.include."
        "GITHUB_CREATE_AN_ISSUE.GITHUB_GET_ISSUE"
    )


def test_run_call_ref_for_all_policy():
    config = GatewayToolkitConfig(integration="slack", connection="slack-main")
    assert config.run_call_ref == "toolkit.composio.slack.slack-main.run.all"


# ---------------------------------------------------------------------------
# Resolver: one config -> two specs
# ---------------------------------------------------------------------------


async def test_resolve_toolkit_yields_search_and_run_specs():
    resolver = AgentaGatewayToolResolver(
        connection=PlatformConnection(
            base_url="https://api.x/api", authorization="Access tok"
        )
    )
    config = GatewayToolkitConfig(
        integration="github",
        connection="github-main",
        tools=ToolkitPolicy(mode="include", actions=["CREATE_AN_ISSUE"]),
    )

    resolution = await resolver.resolve_toolkit([config])

    assert len(resolution.tool_specs) == 2
    search, run = resolution.tool_specs
    assert search.name == "github_github_main_search"
    assert search.call_ref == config.search_call_ref
    assert run.name == "github_github_main_run"
    assert run.call_ref == config.run_call_ref
    assert run.permission == "ask"  # default carried onto the spec
    # The include allow-list is offered to the model as an enum of full Composio slugs.
    assert run.input_schema["properties"]["action"]["enum"] == [
        "GITHUB_CREATE_AN_ISSUE"
    ]
    # Both callbacks point at the same server-side execute endpoint.
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
