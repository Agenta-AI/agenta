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
    ClaudePermissions,
    Endpoint,
    HarnessType,
    Message,
    PiAgentConfig,
    ResolvedConnection,
    SandboxPermission,
    SkillConfig,
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
    "provider",
    "connection",
    "deployment",
    "endpoint",
    "credentialMode",
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
    "sandboxPermission",
    "claudeSettings",
}

_CUSTOM_TOOL = {
    "name": "get_user",
    "description": "Get a user",
    "inputSchema": {"type": "object", "properties": {}},
    "callRef": "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn",
    "kind": "callback",
    "readOnly": True,
}
_CALLBACK = ToolCallback(
    endpoint="https://api.example/tools/call", authorization="Access tok-123"
)
# One resolved inline skill package (the post-embed shape that rides the wire). A bundled
# file is included so the `files[]` wire shape (camelCase `executable`) is exercised too.
_SKILL = {
    "name": "release-notes",
    "description": "Draft release notes from a changelog.",
    "body": "Read the changelog, then write release notes.",
    "files": [
        {"path": "scripts/draft.py", "content": "print('draft')", "executable": True}
    ],
    "disable_model_invocation": True,
    "allow_executable_files": True,
}


def _pi_payload():
    config = PiAgentConfig(
        agents_md="You are a helpful assistant.",
        model="openai-codex/gpt-5.5",
        builtin_tools=["read", "write"],
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        skills=[dict(_SKILL)],
        sandbox_permission=SandboxPermission(network={"mode": "off"}),
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
        permissions=ClaudePermissions(
            default_mode="acceptEdits",
            allow=["Read", "Bash(npm run:*)"],
            deny=["WebFetch"],
        ),
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
        skills=[dict(_SKILL)],
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
    # ...plus the resolved inline skill packages, on their own seam (not in `wire_tools`).
    assert payload["skills"][0]["name"] == "release-notes"
    assert payload["skills"][0]["files"][0]["path"] == "scripts/draft.py"


def test_request_to_wire_skills_ride_their_own_seam_not_tools():
    # Skills are emitted by `wire_skills`, not folded into the tool wire.
    config = PiAgentConfig(skills=[dict(_SKILL)])
    assert "skills" not in config.wire_tools()
    assert config.wire_skills() == {"skills": [SkillConfig(**_SKILL).to_wire()]}


def test_request_to_wire_omits_skills_when_none():
    # No declared skills -> no `skills` key (keeps a skill-free payload byte-identical).
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert "skills" not in payload


def test_request_to_wire_pi_matches_golden(golden):
    payload = _pi_payload()
    assert payload == golden("run_request.pi.json")
    # The Composio read-only hint rides the wire as camelCase `readOnly`.
    assert payload["customTools"][0]["readOnly"] is True
    # No explicit author disposition + read_only=True -> derived `allow` rides the wire.
    assert payload["customTools"][0]["disposition"] == "allow"
    # The declared sandbox boundary rides the wire as nested camelCase `sandboxPermission`;
    # the unset `filesystem` is dropped (declared, not enforced) so it never appears.
    assert payload["sandboxPermission"] == {
        "network": {"mode": "off", "allowlist": []},
        "enforcement": "strict",
    }
    # `claudeSettings` is Claude-only: a Pi config never emits it (the method is a no-op on the
    # base, and Pi exposes no permission knobs), so the key is absent.
    assert "claudeSettings" not in payload


def test_request_to_wire_claude_matches_golden(golden):
    payload = _claude_payload()
    assert payload == golden("run_request.claude.json")
    # No explicit author disposition + read_only=True -> derived `allow` rides the wire.
    assert payload["customTools"][0]["disposition"] == "allow"
    # Claude-specific invariants the golden encodes, asserted explicitly so a failure reads clearly.
    assert payload["tools"] == []  # Claude has no Pi built-ins
    assert payload["permissionPolicy"] == "deny"  # Claude gates tool use
    assert "systemPrompt" not in payload  # Claude exposes no prompt overrides
    assert "appendSystemPrompt" not in payload
    # No sandbox boundary declared on this config -> the key is absent (optional, default None).
    assert "sandboxPermission" not in payload
    # The Claude harness's own permission knobs ride the wire as nested camelCase `claudeSettings`;
    # the author's mode + allow/deny rules are emitted (ask is absent because no `ask` was set).
    assert payload["claudeSettings"] == {
        "defaultMode": "acceptEdits",
        "allow": ["Read", "Bash(npm run:*)"],
        "deny": ["WebFetch"],
    }


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


def test_request_to_wire_carries_resolved_connection_non_secret_descriptor():
    # A threaded resolved connection is the authoritative provider/model descriptor: the
    # resolved `model` overrides the config-build `model`, `provider`/`deployment`/
    # `credentialMode`/`endpoint.baseUrl` ride the wire, and the secret `key` NEVER does (it
    # rides `secrets`; `env` is masked from the wire by `ResolvedConnection.to_wire`).
    config = PiAgentConfig(
        model="openai/gpt-5.5",  # the config-build model
        resolved_connection=ResolvedConnection(
            provider="openai",
            model="gpt-5.5-2026",  # the resolved EXACT model, wins over `model`
            deployment="custom",
            credential_mode="env",
            env={"OPENAI_API_KEY": "sk-secret"},  # secret channel; never on the wire
            endpoint=Endpoint(base_url="https://gw.example/v1"),
        ),
    )
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        secrets={"OPENAI_API_KEY": "sk-secret"},  # the secret rides here, by design
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["provider"] == "openai"
    assert payload["credentialMode"] == "env"
    assert payload["deployment"] == "custom"
    assert payload["endpoint"] == {"baseUrl": "https://gw.example/v1"}
    # Exactly one `model` key, and it is the resolved exact model (last spread wins).
    assert payload["model"] == "gpt-5.5-2026"
    # The secret only rides `secrets`; `env` is never serialized onto the wire.
    assert payload["secrets"] == {"OPENAI_API_KEY": "sk-secret"}
    assert "env" not in payload
    assert (
        "sk-secret" not in {k: v for k, v in payload.items() if k != "secrets"}.values()
    )


def test_request_to_wire_omits_resolved_connection_when_none():
    # No resolved connection -> no resolved-connection keys, so a config without one is
    # byte-identical to before (the golden contract; the golden fixtures set none).
    config = PiAgentConfig(model="gpt-5.5")
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert config.wire_resolved_connection() == {}
    assert "provider" not in payload
    assert "credentialMode" not in payload
    assert "deployment" not in payload
    assert "endpoint" not in payload
    assert payload["model"] == "gpt-5.5"


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


def test_request_to_wire_omits_sandbox_permission_when_none():
    # No declared boundary -> no `sandboxPermission` key (keeps a boundary-free payload
    # byte-identical, so existing configs/fixtures are unaffected).
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert "sandboxPermission" not in payload


def test_request_to_wire_omits_claude_settings_when_none():
    # No authored permissions on a Claude config -> no `claudeSettings` key (a Claude run
    # without harness options is byte-identical, so existing configs/fixtures are unaffected).
    payload = request_to_wire(
        engine="sandbox-agent",
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=ClaudeAgentConfig(),
        messages=[Message(role="user", content="hi")],
    )
    assert "claudeSettings" not in payload


def test_request_to_wire_omits_claude_settings_when_empty():
    # Authored-but-empty permissions (no mode, all lists empty) -> still omitted, so an empty
    # author bag never emits nulls or empty arrays on the wire.
    payload = request_to_wire(
        engine="sandbox-agent",
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=ClaudeAgentConfig(permissions=ClaudePermissions()),
        messages=[Message(role="user", content="hi")],
    )
    assert "claudeSettings" not in payload


def test_claude_permissions_to_wire_drops_mode_and_empty_lists():
    # The serializer drops `defaultMode` when unset and any empty allow/deny/ask list, so only
    # the authored fields appear (camelCase aliases).
    perms = ClaudePermissions(deny=["Write", "Edit"])
    assert perms.to_wire() == {"deny": ["Write", "Edit"]}
    full = ClaudePermissions(
        default_mode="plan", allow=["Read"], deny=["Bash"], ask=["WebFetch"]
    )
    assert full.to_wire() == {
        "defaultMode": "plan",
        "allow": ["Read"],
        "deny": ["Bash"],
        "ask": ["WebFetch"],
    }


def test_request_to_wire_carries_sandbox_permission_allowlist():
    # The allowlist mode rides the wire with its CIDR ranges and the default enforcement.
    config = PiAgentConfig(
        sandbox_permission=SandboxPermission(
            network={"mode": "allowlist", "allowlist": ["10.0.0.0/8"]},
        )
    )
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["sandboxPermission"] == {
        "network": {"mode": "allowlist", "allowlist": ["10.0.0.0/8"]},
        "enforcement": "strict",
    }
