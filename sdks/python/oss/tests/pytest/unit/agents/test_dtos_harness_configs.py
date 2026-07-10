"""Per-harness configs: how each shapes its own tool/prompt fields for the ``/run`` payload.

These are the per-harness halves of the wire contract. ``test_wire_contract`` checks the full
payload against the golden; this file pins each config's contribution in isolation so a failure
points straight at the harness whose shape changed.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    ClaudeAgentTemplate,
    ClientToolSpec,
    HarnessAgentTemplate,
    PiAgentTemplate,
    ToolCallback,
)

_CALLBACK = ToolCallback(endpoint="https://api.example/tools/call", authorization="A")


def test_pi_wire_tools_is_native_and_ships_permissions():
    config = PiAgentTemplate(
        builtin_tools=["read"],
        tool_specs=[
            ClientToolSpec(
                name="t",
                description="t",
            )
        ],
        tool_callback=_CALLBACK,
    )
    assert config.wire_tools() == {
        "tools": ["read"],
        "customTools": [
            {
                "name": "t",
                "description": "t",
                "inputSchema": {"type": "object", "properties": {}},
                "kind": "client",
            }
        ],
        "toolCallback": {
            "endpoint": "https://api.example/tools/call",
            "authorization": "A",
        },
        "permissions": {"default": "allow_reads"},
    }


def test_pi_wire_tools_without_callback():
    assert PiAgentTemplate().wire_tools()["toolCallback"] is None


def test_pi_wire_prompt_emits_only_set_overrides():
    assert PiAgentTemplate().wire_prompt() == {}
    assert PiAgentTemplate(system="s").wire_prompt() == {"systemPrompt": "s"}
    assert PiAgentTemplate(append_system="a").wire_prompt() == {
        "appendSystemPrompt": "a"
    }
    assert PiAgentTemplate(system="", append_system="a").wire_prompt() == {
        "systemPrompt": "",  # an explicit empty string is still an override here
        "appendSystemPrompt": "a",
    }


def test_claude_wire_tools_has_no_builtins_and_carries_permissions():
    config = ClaudeAgentTemplate(
        tool_specs=[
            ClientToolSpec(
                name="t",
                description="t",
            )
        ],
        tool_callback=_CALLBACK,
        permission_default="deny",
    )
    wire = config.wire_tools()
    assert wire["tools"] == []  # Claude has no Pi built-ins
    assert wire["customTools"] == [
        {
            "name": "t",
            "description": "t",
            "inputSchema": {"type": "object", "properties": {}},
            "kind": "client",
        }
    ]
    assert wire["permissions"] == {"default": "deny"}
    assert "permissionPolicy" not in wire


def test_claude_defaults_to_allow_reads_permissions_and_empty_prompt():
    assert ClaudeAgentTemplate().wire_tools()["permissions"] == {
        "default": "allow_reads"
    }
    assert (
        ClaudeAgentTemplate().wire_prompt() == {}
    )  # Claude exposes no prompt overrides


def test_base_config_wire_tools_is_abstract():
    # The base class does not know any engine's tool shape.
    with pytest.raises(NotImplementedError):
        HarnessAgentTemplate().wire_tools()
    assert HarnessAgentTemplate().wire_prompt() == {}


def test_pi_and_claude_emit_same_permission_block_for_same_config():
    pi = PiAgentTemplate(
        permission_default="ask", harness_permissions={"deny": ["Bash(rm:*)"]}
    )
    claude = ClaudeAgentTemplate(
        permission_default="ask", harness_permissions={"deny": ["Bash(rm:*)"]}
    )
    assert pi.wire_tools()["permissions"] == claude.wire_tools()["permissions"]
    assert pi.wire_tools()["permissions"] == {
        "default": "ask",
        "rules": [{"pattern": "Bash(rm:*)", "permission": "deny"}],
    }


def test_permission_policy_key_absent_from_wire_tools():
    assert "permissionPolicy" not in PiAgentTemplate().wire_tools()
    assert "permissionPolicy" not in ClaudeAgentTemplate().wire_tools()
