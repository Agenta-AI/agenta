"""Codex ``config.toml`` rendering for permission Layers 1 through 3."""

from __future__ import annotations

import tomllib

import pytest

from agenta.sdk.agents.adapters.codex_settings import (
    INTERNAL_TOOL_MCP_SERVER,
    build_codex_settings_files,
)
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import MCPPolicy, MCPToolPolicy, ResolvedMCPServer
from agenta.sdk.agents.tools.models import (
    CallbackToolSpec,
    ClientToolSpec,
    CodeToolSpec,
)


def _config(files):
    assert len(files) == 1
    assert files[0]["path"] == ".codex/config.toml"
    content = files[0]["content"]
    return content, tomllib.loads(content)


def _mcp(name: str, permission=None, tool_names=None) -> ResolvedMCPServer:
    tools = (
        MCPToolPolicy(mode="include", names=tool_names)
        if tool_names
        else MCPToolPolicy()
    )
    return ResolvedMCPServer(
        name=name,
        url="https://x",
        policy=MCPPolicy(permission=permission, tools=tools),
    )


@pytest.mark.parametrize("filesystem", ["readonly", "off"])
def test_filesystem_boundary_derives_read_only_sandbox_mode(filesystem):
    content, config = _config(
        build_codex_settings_files(None, SandboxPermission(filesystem=filesystem))
    )

    assert content == 'sandbox_mode = "read-only"\n'
    assert config["sandbox_mode"] == "read-only"


def test_authored_sandbox_mode_is_not_overridden_by_layer_2():
    content, config = _config(
        build_codex_settings_files(
            {"sandbox_mode": "workspace-write"},
            SandboxPermission(filesystem="readonly"),
        )
    )

    assert content == 'sandbox_mode = "workspace-write"\n'
    assert config["sandbox_mode"] == "workspace-write"


@pytest.mark.parametrize("network_mode", ["off", "allowlist"])
def test_network_restriction_renders_nothing_when_not_expressible(network_mode):
    network = {"mode": network_mode}
    if network_mode == "allowlist":
        network["allowlist"] = ["10.0.0.0/8"]

    assert build_codex_settings_files(None, SandboxPermission(network=network)) == []


def test_mcp_allow_and_ask_render_server_approval_modes():
    content, config = _config(
        build_codex_settings_files(
            None,
            None,
            [_mcp("filesystem", "allow"), _mcp("github", "ask")],
        )
    )

    assert "[mcp_servers.filesystem]" in content
    assert 'default_tools_approval_mode = "approve"' in content
    assert "[mcp_servers.github]" in content
    assert 'default_tools_approval_mode = "prompt"' in content
    assert (
        config["mcp_servers"]["filesystem"]["default_tools_approval_mode"] == "approve"
    )
    assert config["mcp_servers"]["github"]["default_tools_approval_mode"] == "prompt"


def test_mcp_deny_disables_every_known_included_tool():
    content, config = _config(
        build_codex_settings_files(
            None,
            None,
            [_mcp("github", "deny", ["create_issue", "delete_issue"])],
        )
    )

    assert "[mcp_servers.github]" in content
    assert 'disabled_tools = ["create_issue", "delete_issue"]' in content
    assert config["mcp_servers"]["github"]["disabled_tools"] == [
        "create_issue",
        "delete_issue",
    ]


def test_whole_server_deny_without_known_tools_is_omitted():
    assert build_codex_settings_files(None, None, [_mcp("github", "deny")]) == []


def test_reserved_internal_server_rule_is_skipped():
    server = _mcp(INTERNAL_TOOL_MCP_SERVER, "ask")
    tool = CallbackToolSpec(
        name="get_user",
        description="d",
        call_ref="workflow.x",
        permission="allow",
    )
    _, config = _config(build_codex_settings_files(None, None, [server], [tool]))

    internal = config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]
    assert "default_tools_approval_mode" not in internal
    assert internal["tools"]["get_user"]["approval_mode"] == "approve"


def test_tool_allow_ask_and_deny_render_nested_rules():
    allow_tool = CallbackToolSpec(
        name="capital_lookup",
        description="d",
        call_ref="workflow.x",
        permission="allow",
    )
    ask_tool = CodeToolSpec(
        name="writer",
        description="d",
        code="print('write')",
        permission="ask",
    )
    deny_tool = CallbackToolSpec(
        name="danger",
        description="d",
        call_ref="workflow.y",
        permission="deny",
    )

    content, config = _config(
        build_codex_settings_files(None, None, None, [allow_tool, ask_tool, deny_tool])
    )

    assert "[mcp_servers.agenta-tools]" in content
    assert 'disabled_tools = ["danger"]' in content
    assert "[mcp_servers.agenta-tools.tools.capital_lookup]" in content
    assert "[mcp_servers.agenta-tools.tools.writer]" in content
    internal = config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]
    assert internal["disabled_tools"] == ["danger"]
    assert internal["tools"]["capital_lookup"]["approval_mode"] == "approve"
    assert internal["tools"]["writer"]["approval_mode"] == "prompt"


def test_tool_rules_follow_effective_permission_ladder():
    read_tool = CallbackToolSpec(
        name="reader",
        description="d",
        call_ref="workflow.read",
        read_only=True,
    )
    unset_write_tool = CallbackToolSpec(
        name="writer",
        description="d",
        call_ref="workflow.write",
        read_only=False,
    )
    _, config = _config(
        build_codex_settings_files(None, None, None, [read_tool, unset_write_tool])
    )

    tools = config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]["tools"]
    assert tools["reader"]["approval_mode"] == "approve"
    assert tools["writer"]["approval_mode"] == "prompt"

    _, deny_config = _config(
        build_codex_settings_files(
            None, None, None, [unset_write_tool], permission_default="deny"
        )
    )
    assert deny_config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]["disabled_tools"] == [
        "writer"
    ]


def test_client_tool_permissions_use_the_direct_codex_mapping():
    ask_tool = ClientToolSpec(name="ui_pick", description="d", permission="ask")
    deny_tool = ClientToolSpec(name="ui_delete", description="d", permission="deny")
    _, config = _config(
        build_codex_settings_files(None, None, None, [ask_tool, deny_tool])
    )

    internal = config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]
    assert internal["tools"]["ui_pick"]["approval_mode"] == "prompt"
    assert internal["disabled_tools"] == ["ui_delete"]


def test_dynamic_table_names_are_valid_toml_key_segments():
    content, config = _config(
        build_codex_settings_files(
            None,
            None,
            [{"name": "github.v2", "policy": {"permission": "allow"}}],
            [
                {
                    "kind": "callback",
                    "name": "read.item",
                    "description": "d",
                    "callRef": "workflow.x",
                    "permission": "ask",
                }
            ],
        )
    )

    assert '[mcp_servers."github.v2"]' in content
    assert '[mcp_servers.agenta-tools.tools."read.item"]' in content
    assert (
        config["mcp_servers"]["github.v2"]["default_tools_approval_mode"] == "approve"
    )
    assert (
        config["mcp_servers"][INTERNAL_TOOL_MCP_SERVER]["tools"]["read.item"][
            "approval_mode"
        ]
        == "prompt"
    )


def test_fileless_run_still_returns_empty_list():
    assert build_codex_settings_files(None) == []
    assert build_codex_settings_files({}) == []
    assert (
        build_codex_settings_files(
            None,
            SandboxPermission(network={"mode": "on"}, filesystem="on"),
            [_mcp("unset")],
            [],
        )
        == []
    )
