"""Per-harness configs: how each shapes its own tool/prompt fields for the ``/run`` payload.

These are the per-harness halves of the wire contract. ``test_wire_contract`` checks the full
payload against the golden; this file pins each config's contribution in isolation so a failure
points straight at the harness whose shape changed.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    ClaudeAgentConfig,
    HarnessAgentConfig,
    PiAgentConfig,
    ToolCallback,
)

_CALLBACK = ToolCallback(endpoint="https://api.example/tools/call", authorization="A")


def test_pi_wire_tools_is_native_and_never_gates():
    config = PiAgentConfig(
        builtin_tools=["read"],
        custom_tools=[{"name": "t"}],
        tool_callback=_CALLBACK,
    )
    assert config.wire_tools() == {
        "tools": ["read"],
        "customTools": [{"name": "t"}],
        "toolCallback": {
            "endpoint": "https://api.example/tools/call",
            "authorization": "A",
        },
        "permissionPolicy": "auto",  # Pi never gates tool use
    }


def test_pi_wire_tools_without_callback():
    assert PiAgentConfig().wire_tools()["toolCallback"] is None


def test_pi_wire_prompt_emits_only_set_overrides():
    assert PiAgentConfig().wire_prompt() == {}
    assert PiAgentConfig(system="s").wire_prompt() == {"systemPrompt": "s"}
    assert PiAgentConfig(append_system="a").wire_prompt() == {"appendSystemPrompt": "a"}
    assert PiAgentConfig(system="", append_system="a").wire_prompt() == {
        "systemPrompt": "",  # an explicit empty string is still an override here
        "appendSystemPrompt": "a",
    }


def test_claude_wire_tools_has_no_builtins_and_carries_policy():
    config = ClaudeAgentConfig(
        custom_tools=[{"name": "t"}],
        tool_callback=_CALLBACK,
        permission_policy="deny",
    )
    wire = config.wire_tools()
    assert wire["tools"] == []  # Claude has no Pi built-ins
    assert wire["customTools"] == [{"name": "t"}]
    assert wire["permissionPolicy"] == "deny"


def test_claude_defaults_to_auto_policy_and_empty_prompt():
    assert ClaudeAgentConfig().wire_tools()["permissionPolicy"] == "auto"
    assert ClaudeAgentConfig().wire_prompt() == {}  # Claude exposes no prompt overrides


def test_base_config_wire_tools_is_abstract():
    # The base class does not know any engine's tool shape.
    with pytest.raises(NotImplementedError):
        HarnessAgentConfig().wire_tools()
    assert HarnessAgentConfig().wire_prompt() == {}
