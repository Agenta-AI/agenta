"""Codex ``config.toml`` rendering for permission Layers 1 and 2.

Per the D-008 amendment (2026-07-24) no ``[mcp_servers.*]`` approval tables are rendered (codex
0.145 rejects a transport-less server entry at ``session/new``; the runner-side gate is the
tool-permission authority). These tests pin that only flat Layer-1/2 scalars are written and that
a run whose only permission content would have been per-server/per-tool tables writes NO file.
"""

from __future__ import annotations

import tomllib

import pytest

from agenta.sdk.agents.adapters.codex_settings import build_codex_settings_files
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import MCPPolicy, MCPToolPolicy, ResolvedMCPServer


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


# Layer 1: author's Codex-native scalars pass through verbatim.
def test_layer1_scalars_pass_through():
    content, config = _config(
        build_codex_settings_files(
            {"approval_policy": "on-request", "sandbox_mode": "workspace-write"}
        )
    )

    assert config["approval_policy"] == "on-request"
    assert config["sandbox_mode"] == "workspace-write"
    assert "[mcp_servers" not in content


# Layer 2: a read-only/off filesystem reinforces sandbox_mode; nothing else.
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


# Regression (D-008 amendment): a tool-bearing run WITH permission rules never renders an
# [mcp_servers.*] table. A transport-less server entry crashes codex at session/new; the
# runner-side gate is the tool-permission authority.
def test_permission_rules_render_no_mcp_servers_tables():
    files = build_codex_settings_files(
        {"approval_policy": "untrusted"},  # a Layer-1 scalar keeps the file non-empty
        None,
        [
            _mcp("github", permission="ask"),
            _mcp("filesystem", permission="allow"),
            _mcp("blocked", permission="deny", tool_names=["a", "b"]),
        ],
        [
            {
                "kind": "callback",
                "name": "capital_lookup",
                "description": "d",
                "callRef": "workflow.x",
                "permission": "allow",
            },
            {
                "kind": "callback",
                "name": "danger",
                "description": "d",
                "callRef": "workflow.y",
                "permission": "deny",
            },
        ],
    )
    content, config = _config(files)

    # Only the Layer-1 scalar survives; no server/tool tables at all.
    assert content == 'approval_policy = "untrusted"\n'
    assert "mcp_servers" not in config
    assert "[mcp_servers" not in content
    assert "approval_mode" not in content
    assert "default_tools_approval_mode" not in content
    assert "disabled_tools" not in content


def test_permission_only_run_writes_no_file():
    # No Layer-1/2 scalar authored/derived: the tables that WOULD have been the only content are
    # no longer rendered, so nothing is written at all.
    assert (
        build_codex_settings_files(
            None,
            None,
            [
                _mcp("github", permission="ask"),
                _mcp("blocked", permission="deny", tool_names=["a"]),
            ],
            [
                {
                    "kind": "callback",
                    "name": "writer",
                    "description": "d",
                    "callRef": "workflow.x",
                    "permission": "deny",
                }
            ],
        )
        == []
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
