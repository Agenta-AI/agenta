"""The ``/run`` wire contract: ``request_to_wire`` / ``result_from_wire``.

This is the highest-value regression guard in the agent runtime. ``wire.py`` (the Python
producer) and ``services/agent/src/protocol.ts`` (the TS consumer) are hand-mirrored, so the
two can drift silently. The golden fixtures in ``golden/`` are the shared anchor: this file
asserts the Python side against them, and the TS side asserts the same files (a later PR).

If a field is added, renamed, or removed on the wire, a golden assertion here fails on
purpose. Regenerate the golden deliberately, and update ``protocol.ts`` and ``KNOWN_REQUEST_KEYS``
to match.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    AgentaAgentConfig,
    ClaudeAgentConfig,
    HarnessType,
    Message,
    PiAgentConfig,
    ToolCallback,
    TraceContext,
)
from agenta.sdk.agents.utils.wire import request_to_wire, result_from_wire

# The full set of top-level keys ``request_to_wire`` may emit. The TS ``AgentRunRequest``
# interface must declare a superset of these. Adding a key here without adding it to
# protocol.ts is exactly the drift this set exists to catch.
KNOWN_REQUEST_KEYS = {
    "backend",
    "harness",
    "sandbox",
    "sessionId",
    "agentsMd",
    "model",
    "messages",
    "secrets",
    "trace",
    "tools",
    "customTools",
    "mcpServers",
    "toolCallback",
    "permissionPolicy",
    "systemPrompt",
    "appendSystemPrompt",
    "skills",
}

_CUSTOM_TOOL = {
    "name": "get_user",
    "description": "Get a user",
    "inputSchema": {"type": "object", "properties": {}},
    "callRef": "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn",
    "kind": "callback",
}
_CALLBACK = ToolCallback(
    endpoint="https://api.example/tools/call", authorization="Access tok-123"
)


def _pi_payload():
    config = PiAgentConfig(
        agents_md="You are a helpful assistant.",
        model="openai-codex/gpt-5.5",
        builtin_tools=["read", "write"],
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        system="You are Pi.",
        append_system="Be terse.",
    )
    return request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        secrets={"OPENAI_API_KEY": "sk-test"},
        trace=TraceContext(
            traceparent="00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            endpoint="https://otlp.example/v1/traces",
            authorization="Access tok-123",
            capture_content=True,
        ),
        session_id="sess-1",
    )


def _claude_payload():
    config = ClaudeAgentConfig(
        agents_md="You are a helpful assistant.",
        model="claude-sonnet-4-6",
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        permission_policy="deny",
    )
    return request_to_wire(
        engine="sandbox-agent",
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        secrets={"ANTHROPIC_API_KEY": "sk-ant"},
        trace=None,
        session_id=None,
    )


def _agenta_payload():
    config = AgentaAgentConfig(
        agents_md="Agenta preamble + project rules.",
        model="gpt-5.5",
        builtin_tools=["read", "bash"],
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        append_system="You are an Agenta agent.",
        skills=["agenta-getting-started"],
    )
    return request_to_wire(
        engine="pi",
        harness=HarnessType.AGENTA,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )


def test_request_to_wire_agenta_carries_skills_and_pi_shape():
    payload = _agenta_payload()
    assert set(payload) <= KNOWN_REQUEST_KEYS
    # Agenta is a Pi config: same tool shape, never gates, exposes the prompt overrides...
    assert payload["permissionPolicy"] == "auto"
    assert payload["tools"] == ["read", "bash"]
    assert payload["appendSystemPrompt"] == "You are an Agenta agent."
    # ...plus the forced skills the runner loads.
    assert payload["skills"] == ["agenta-getting-started"]


def test_request_to_wire_pi_has_no_skills_key():
    # Only the Agenta config emits `skills`; the plain Pi config must not.
    assert "skills" not in _pi_payload()


def test_request_to_wire_pi_matches_golden(golden):
    assert _pi_payload() == golden("run_request.pi.json")


def test_request_to_wire_claude_matches_golden(golden):
    payload = _claude_payload()
    assert payload == golden("run_request.claude.json")
    # Claude-specific invariants the golden encodes, asserted explicitly so a failure reads clearly.
    assert payload["tools"] == []  # Claude has no Pi built-ins
    assert payload["permissionPolicy"] == "deny"  # Claude gates tool use
    assert "systemPrompt" not in payload  # Claude exposes no prompt overrides
    assert "appendSystemPrompt" not in payload


def test_request_to_wire_has_no_prompt_key():
    # The serializer emits `messages` only; the TS side derives the latest turn with
    # `resolvePromptText`. This asymmetry is intentional and easy to break, so lock it.
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert "prompt" not in payload


def test_request_to_wire_emits_only_known_keys():
    pi = _pi_payload()
    claude = _claude_payload()
    assert set(pi) <= KNOWN_REQUEST_KEYS
    assert set(claude) <= KNOWN_REQUEST_KEYS
    # The Pi case must actually exercise the prompt-override keys, otherwise this guard would
    # silently stop covering them.
    assert {"systemPrompt", "appendSystemPrompt"} <= set(pi)


def test_pi_permission_policy_is_always_auto():
    # Pi never gates tool use, regardless of any requested policy.
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["permissionPolicy"] == "auto"


def test_result_from_wire_parses_ok(golden):
    result = result_from_wire(golden("run_result.ok.json"))

    assert result.output == "Hello!"
    assert [m.role for m in result.messages] == ["assistant"]
    # The event with no `type` is dropped on parse; the other three survive.
    assert [e.type for e in result.events] == ["message", "usage", "done"]
    assert result.events[0].data == {"type": "message", "text": "Hello!"}
    assert result.usage == {"input": 10, "output": 5, "total": 15, "cost": 0.001}
    assert result.stop_reason == "end_turn"
    assert result.session_id == "sess-42"
    assert result.model == "gpt-5.5"
    assert result.trace_id == "trace-abc"
    # Capabilities come back camelCase and map onto snake_case flags.
    assert result.capabilities is not None
    assert result.capabilities.mcp_tools is True
    assert result.capabilities.images is False
    assert result.capabilities.text_messages is True


def test_result_from_wire_raises_on_failure(golden):
    with pytest.raises(RuntimeError, match="model exploded"):
        result_from_wire(golden("run_result.error.json"))


def test_result_from_wire_minimal_ok():
    # A bare success: empty output, empty collections, no capabilities.
    result = result_from_wire({"ok": True})
    assert result.output == ""
    assert result.messages == []
    assert result.events == []
    assert result.capabilities is None
    assert result.session_id is None


def test_request_to_wire_carries_code_client_and_mcp_specs():
    # The three-axes surface reaches the wire intact: a code spec keeps its executor fields
    # (kind/runtime/code/env) and the orthogonal axes (needsApproval/render); a client spec
    # has no callRef; user MCP servers ride `mcpServers`.
    config = PiAgentConfig(
        custom_tools=[
            {
                "name": "calc",
                "description": "calc",
                "inputSchema": {"type": "object", "properties": {}},
                "kind": "code",
                "runtime": "python",
                "code": "def main(): return 1",
                "env": {"STRIPE_API_KEY": "sk"},
                "needsApproval": True,
                "render": {"kind": "component", "component": "Calc"},
            },
            {
                "name": "pick",
                "description": "pick",
                "inputSchema": {"type": "object", "properties": {}},
                "kind": "client",
            },
        ],
        mcp_servers=[
            {
                "name": "github",
                "transport": "stdio",
                "command": "npx",
                "env": {"GITHUB_TOKEN": "ghp"},
                "tools": ["create_issue"],
            }
        ],
    )
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    code = next(t for t in payload["customTools"] if t["name"] == "calc")
    assert code["kind"] == "code"
    assert code["runtime"] == "python"
    assert code["code"] == "def main(): return 1"
    assert code["env"] == {"STRIPE_API_KEY": "sk"}
    assert code["needsApproval"] is True
    assert code["render"] == {"kind": "component", "component": "Calc"}
    client = next(t for t in payload["customTools"] if t["name"] == "pick")
    assert client["kind"] == "client"
    assert "callRef" not in client
    assert payload["mcpServers"] == [
        {
            "name": "github",
            "transport": "stdio",
            "command": "npx",
            "env": {"GITHUB_TOKEN": "ghp"},
            "tools": ["create_issue"],
        }
    ]


def test_request_to_wire_omits_mcp_servers_when_none():
    # No declared servers -> no `mcpServers` key (keeps a tool-free payload byte-identical).
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert "mcpServers" not in payload
