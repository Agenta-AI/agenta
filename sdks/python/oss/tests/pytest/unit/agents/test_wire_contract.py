"""The ``/run`` wire contract: ``request_to_wire`` / ``result_from_wire``.

This is the highest-value regression guard in the agent runtime. ``wire.py`` (the Python
producer) and ``services/agent/src/protocol.ts`` (the TS consumer) are hand-mirrored, so the
two can drift silently. The golden fixtures in ``golden/`` are the shared anchor: this file
asserts the Python side against them, and the TS side asserts the same files (a later PR).

If a field is added, renamed, or removed on the wire, a golden assertion here fails on
purpose. Regenerate the golden deliberately, and update ``protocol.ts`` and ``KNOWN_REQUEST_KEYS``
to match.

There is no engine selector on the wire: the runner drives one engine (the sandbox-agent ACP
path) and ``harness`` (``pi_core`` / ``pi_agenta`` / ``claude``) picks the agent.
"""

from __future__ import annotations

import json

import pytest

from agenta.sdk.agents import (
    AgentaAgentTemplate,
    ClaudeAgentTemplate,
    CodexAgentTemplate,
    Endpoint,
    HarnessType,
    Message,
    PiAgentTemplate,
    ResolvedConnection,
    RunContext,
    RunContextReference,
    RunContextTrace,
    RunContextWorkflow,
    SandboxPermission,
    SkillTemplate,
    ToolCallback,
    TraceContext,
)
from agenta.sdk.agents.utils.wire import (
    request_to_wire,
    result_from_wire,
    sanitize_runner_error,
)

# The full set of top-level keys ``request_to_wire`` may emit. The TS ``AgentRunRequest``
# interface must declare a superset of these. Adding a key here without adding it to
# protocol.ts is exactly the drift this set exists to catch.
KNOWN_REQUEST_KEYS = {
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
    "context",
    "telemetry",
    "runContext",
    "tools",
    "customTools",
    "mcpServers",
    "toolCallback",
    "permissionPolicy",
    "systemPrompt",
    "appendSystemPrompt",
    "skills",
    "sandboxPermission",
    "harnessFiles",
    "turnId",
    "projectId",
}

_CUSTOM_TOOL = {
    "name": "get_user",
    "description": "Get a user",
    "inputSchema": {"type": "object", "properties": {}},
    "callRef": "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn",
    "kind": "callback",
    "readOnly": True,
}
# A DIRECT-CALL tool (direct-call tools, Phase 1): a callback spec that carries a `call`
# descriptor instead of a `callRef` (the `call` XOR `callRef` rule). Plumbing only — nothing
# emits or dispatches it yet; the golden pins the wire shape so the optional field round-trips.
_DIRECT_CALL_TOOL = {
    "name": "get_weather",
    "description": "Look up weather for a city",
    "inputSchema": {"type": "object", "properties": {"city": {"type": "string"}}},
    "kind": "callback",
    "call": {
        "method": "POST",
        "path": "/api/workflows/invoke",
        "body": {"references": {"workflow_revision": {"id": "rev_abc123"}}},
        "args_into": "data.inputs",
    },
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
    config = PiAgentTemplate(
        agents_md="You are a helpful assistant.",
        model="openai-codex/gpt-5.5",
        builtin_tools=["read", "write"],
        custom_tools=[dict(_CUSTOM_TOOL), dict(_DIRECT_CALL_TOOL)],
        tool_callback=_CALLBACK,
        skills=[dict(_SKILL)],
        sandbox_permission=SandboxPermission(network={"mode": "off"}),
        system="You are Pi.",
        append_system="Be terse.",
    )
    return request_to_wire(
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
        # The run's own context (trace + workflow identity), refreshed per turn and consumed only by
        # a tool's `call.context` binding at dispatch (direct-call tools, Phase 3a). The workflow is
        # grouped into the platform's three entities (artifact / variant / revision); `to_wire`
        # drops the unset reference fields. The conversation id rides the top-level `session_id`,
        # not run context.
        run_context=RunContext(
            workflow=RunContextWorkflow(
                artifact=RunContextReference(id="wf_abc"),
                variant=RunContextReference(id="var_abc", slug="weather-agent"),
                revision=RunContextReference(id="rev_abc123", version="3"),
                is_draft=False,
            ),
            trace=RunContextTrace(
                trace_id="0af7651916cd43dd8448eb211c80319c",
                span_id="b7ad6b7169203331",
            ),
        ),
        session_id="sess-1",
    )


def _claude_payload():
    config = ClaudeAgentTemplate(
        agents_md="You are a helpful assistant.",
        model="claude-sonnet-4-6",
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        permission_policy="deny",
        skills=[dict(_SKILL)],
        harness_permissions={
            "default_mode": "acceptEdits",
            "allow": ["Read", "Bash(npm run:*)"],
            "deny": ["WebFetch"],
        },
    )
    return request_to_wire(
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        secrets={"ANTHROPIC_API_KEY": "sk-ant"},
        trace=None,
        session_id=None,
    )


def _codex_payload():
    config = CodexAgentTemplate(
        agents_md="You are a helpful assistant.",
        model="gpt-5.5",
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        permission_policy="deny",
    )
    return request_to_wire(
        harness=HarnessType.CODEX,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        secrets={"OPENAI_API_KEY": "sk-test"},
        trace=None,
        session_id=None,
    )


def _agenta_payload():
    config = AgentaAgentTemplate(
        agents_md="Agenta preamble + project rules.",
        model="gpt-5.5",
        builtin_tools=["read", "bash"],
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        append_system="You are an Agenta agent.",
        skills=[dict(_SKILL)],
    )
    return request_to_wire(
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
    config = PiAgentTemplate(skills=[dict(_SKILL)])
    assert "skills" not in config.wire_tools()
    assert config.wire_skills() == {"skills": [SkillTemplate(**_SKILL).to_wire()]}


def test_request_to_wire_omits_skills_when_none():
    # No declared skills -> no `skills` key (keeps a skill-free payload byte-identical).
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "skills" not in payload


def test_request_to_wire_pi_matches_golden(golden):
    payload = _pi_payload()
    assert payload == golden("run_request.pi_core.json")
    # The Composio read-only hint rides the wire as camelCase `readOnly`.
    assert payload["customTools"][0]["readOnly"] is True
    # No explicit author permission + read_only=True -> derived `allow` rides the wire.
    assert payload["customTools"][0]["permission"] == "allow"
    # The direct-call tool rides the wire carrying its `call` descriptor and NO `callRef`
    # (the `call` XOR `callRef` rule). The descriptor keeps method/path/body and the snake_case
    # `args_into`; `context` is unset so it is omitted. Plumbing only — the runner forwards it
    # opaquely in Phase 1.
    direct = payload["customTools"][1]
    assert direct["kind"] == "callback"
    assert "callRef" not in direct
    assert direct["call"] == {
        "method": "POST",
        "path": "/api/workflows/invoke",
        "body": {"references": {"workflow_revision": {"id": "rev_abc123"}}},
        "args_into": "data.inputs",
    }
    # The run's own context rides as `runContext` (direct-call tools, Phase 3a): the workflow +
    # trace identity, with snake_case inner keys (the `$ctx.<key>` binding namespace), the workflow
    # grouped into artifact / variant / revision references, and the unset reference fields dropped
    # by `to_wire`. The conversation id is NOT here — it rides the top-level `sessionId`.
    assert payload["runContext"] == {
        "workflow": {
            "artifact": {"id": "wf_abc"},
            "variant": {"id": "var_abc", "slug": "weather-agent"},
            "revision": {"id": "rev_abc123", "version": "3"},
            "is_draft": False,
        },
        "trace": {
            "trace_id": "0af7651916cd43dd8448eb211c80319c",
            "span_id": "b7ad6b7169203331",
        },
    }
    assert "session_id" not in payload["runContext"]
    # The run's tracing inputs ride the wire grouped by role (trace/telemetry restructure): the
    # per-call W3C propagation under `context.propagation`, and the operator-owned exporter config +
    # capture policy under `telemetry` (the credential nested under the OTLP exporter's standard
    # `authorization` header). No single `trace` bucket mixes the four roles anymore.
    assert payload["context"] == {
        "propagation": {
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            "baggage": None,
        }
    }
    assert payload["telemetry"] == {
        "capture": {"content": {"enabled": True}},
        "exporters": {
            "otlp": {
                "endpoint": "https://otlp.example/v1/traces",
                "headers": {"authorization": "Access tok-123"},
            }
        },
    }
    assert "trace" not in payload
    # The declared sandbox boundary rides the wire as nested camelCase `sandboxPermission`;
    # the unset `filesystem` is dropped (declared, not enforced) so it never appears.
    assert payload["sandboxPermission"] == {
        "network": {"mode": "off", "allowlist": []},
        "enforcement": "strict",
    }
    # Pi renders no harness files, so the generic `harnessFiles` key is absent.
    assert "harnessFiles" not in payload


def test_request_to_wire_omits_run_context_when_none():
    # No run context passed -> no `runContext` key (a run that needs no `call.context` binding stays
    # byte-identical to before, the same discipline skills/mcpServers/sandboxPermission use).
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "runContext" not in payload


def test_request_to_wire_omits_run_context_when_empty():
    # An entirely-empty run context (no identity to bind) serializes to {} and is dropped, so it
    # never rides the wire as a noise `"runContext": {}` key.
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        run_context=RunContext(),
    )
    assert "runContext" not in payload


def test_request_to_wire_carries_turn_id_when_set():
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        turn_id="turn-abc123",
    )
    assert payload["turnId"] == "turn-abc123"
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_omits_turn_id_when_none():
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "turnId" not in payload


def test_request_to_wire_carries_project_id_when_set():
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        project_id="proj-abc123",
    )
    assert payload["projectId"] == "proj-abc123"
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_omits_project_id_when_none():
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "projectId" not in payload


def test_request_to_wire_claude_matches_golden(golden):
    payload = _claude_payload()
    assert payload == golden("run_request.claude.json")
    # The claude payload threads no run context, so `runContext` is absent (the golden has none).
    assert "runContext" not in payload
    # No trace context threaded on this config: both role-separated keys are null (matching the
    # prior single `trace: null`), and the legacy `trace` key is gone.
    assert payload["context"] is None
    assert payload["telemetry"] is None
    assert "trace" not in payload
    # No explicit author permission + read_only=True -> derived `allow` rides the wire.
    assert payload["customTools"][0]["permission"] == "allow"
    # Claude-specific invariants the golden encodes, asserted explicitly so a failure reads clearly.
    assert payload["tools"] == []  # Claude has no Pi built-ins
    assert payload["permissionPolicy"] == "deny"  # Claude gates tool use
    assert "systemPrompt" not in payload  # Claude exposes no prompt overrides
    assert "appendSystemPrompt" not in payload
    # Claude carries resolved inline skills on the same `skills` seam Pi uses (the runner
    # installs them into Claude's project-local `.claude/skills/<name>` tree). This regressed
    # twice via merge-loss, so it is pinned in both the golden and the cross-language contract.
    assert payload["skills"][0]["name"] == "release-notes"
    assert payload["skills"][0]["files"][0]["path"] == "scripts/draft.py"
    assert payload["skills"][0]["disableModelInvocation"] is True
    # No sandbox boundary declared on this config -> the key is absent (optional, default None).
    assert "sandboxPermission" not in payload
    # The claude adapter (Python) translated the author's permissions slice into a rendered
    # `.claude/settings.json`, carried on the generic `harnessFiles` seam. The runner writes it blind.
    # The `allow` list also carries the per-resolved-tool rule for the internal `agenta-tools` MCP
    # server (F-046): `_CUSTOM_TOOL` is a read-only callback tool -> effective `allow` ->
    # `mcp__agenta-tools__get_user`, so Claude runs it instead of parking on its own permission gate.
    assert payload["harnessFiles"] == [
        {
            "path": ".claude/settings.json",
            "content": json.dumps(
                {
                    "permissions": {
                        "defaultMode": "acceptEdits",
                        "allow": [
                            "Read",
                            "Bash(npm run:*)",
                            "mcp__agenta-tools__get_user",
                        ],
                        "deny": ["WebFetch"],
                    }
                },
                indent=2,
            ),
        }
    ]


def test_request_to_wire_codex_matches_golden(golden):
    payload = _codex_payload()
    assert payload == golden("run_request.codex.json")
    assert payload["harness"] == "codex"
    assert payload["tools"] == []
    assert payload["permissionPolicy"] == "deny"
    assert "systemPrompt" not in payload
    assert "appendSystemPrompt" not in payload
    assert "harnessFiles" not in payload
    assert payload["customTools"][0]["permission"] == "allow"
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_has_no_prompt_key():
    # The serializer emits `messages` only; the TS side derives the latest turn with
    # `resolvePromptText`. This asymmetry is intentional and easy to break, so lock it.
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "prompt" not in payload


def test_request_to_wire_emits_only_known_keys():
    pi = _pi_payload()
    claude = _claude_payload()
    codex = _codex_payload()
    assert set(pi) <= KNOWN_REQUEST_KEYS
    assert set(claude) <= KNOWN_REQUEST_KEYS
    assert set(codex) <= KNOWN_REQUEST_KEYS
    # The Pi case must actually exercise the prompt-override keys, otherwise this guard would
    # silently stop covering them.
    assert {"systemPrompt", "appendSystemPrompt"} <= set(pi)


def test_request_to_wire_carries_resolved_connection_non_secret_descriptor():
    # A threaded resolved connection is the authoritative provider/model descriptor: the
    # resolved `model` overrides the config-build `model`, `provider`/`deployment`/
    # `credentialMode`/`endpoint.baseUrl` ride the wire, and the secret `key` NEVER does (it
    # rides `secrets`; `env` is masked from the wire by `ResolvedConnection.to_wire`).
    config = PiAgentTemplate(
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
    config = PiAgentTemplate(model="gpt-5.5")
    payload = request_to_wire(
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
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
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


def test_sanitize_runner_error_passes_clean_message_through():
    # A concise, single-line message (what conciseError emits for known cases) is unchanged.
    clean = "pi_core: model authentication failed — add the project's Anthropic key."
    assert sanitize_runner_error(clean) == clean


def test_sanitize_runner_error_strips_multiline_stack_to_first_line():
    raw = (
        "TypeError: cannot read x\n"
        "    at run (/app/services/agent/src/engine.ts:12:3)\n"
        "    at process (/app/node_modules/foo.js:99:1)"
    )
    # Only the first line survives; the stack frames never reach the caller.
    assert sanitize_runner_error(raw) == "TypeError: cannot read x"


def test_sanitize_runner_error_falls_back_when_first_line_is_a_stack_frame():
    raw = 'File "/abs/secret/path.py", line 12, in run\n    raise ValueError("boom")'
    assert sanitize_runner_error(raw) == "agent run failed"


def test_sanitize_runner_error_caps_length():
    raw = "x" * 1000
    result = sanitize_runner_error(raw)
    assert len(result) <= 300
    assert result.endswith("…")


def test_sanitize_runner_error_handles_none_and_empty():
    assert sanitize_runner_error(None) == "agent run failed"
    assert sanitize_runner_error("") == "agent run failed"


def test_result_from_wire_sanitizes_a_leaky_error():
    leaky = {
        "ok": False,
        "error": "boom\n    at run (/app/src/engine.ts:1:1)",
    }
    with pytest.raises(RuntimeError) as exc:
        result_from_wire(leaky)
    message = str(exc.value)
    assert "boom" in message
    assert "/app/src/engine.ts" not in message
    assert "\n" not in message


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
    config = PiAgentTemplate(
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
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "mcpServers" not in payload


def test_request_to_wire_omits_sandbox_permission_when_none():
    # No declared boundary -> no `sandboxPermission` key (keeps a boundary-free payload
    # byte-identical, so existing configs/fixtures are unaffected).
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "sandboxPermission" not in payload


def test_request_to_wire_omits_harness_files_when_none():
    # No authored options on a Claude config -> the claude adapter renders nothing, so no
    # `harnessFiles` key (a Claude run without harness options is byte-identical to before).
    payload = request_to_wire(
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=ClaudeAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "harnessFiles" not in payload


def test_request_to_wire_pi_renders_no_harness_files_from_its_options():
    # The per-harness translation is now in Python and only the claude config renders files; a Pi
    # config carrying its prompt overrides emits no `harnessFiles` (those ride `systemPrompt` /
    # `appendSystemPrompt`, not a file).
    config = PiAgentTemplate(system="You are Pi.")
    payload = request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert "harnessFiles" not in payload
    assert "harnessOptions" not in payload


def test_request_to_wire_claude_renders_settings_from_options_and_boundaries():
    # The claude config's `wire_harness_files` is the Python claude adapter: it merges the author's
    # permissions slice with the Layer-2 sandbox derivation and Layer-3 MCP permissions into one
    # `.claude/settings.json` file. network:off -> WebFetch/WebSearch deny; an `ask` MCP server ->
    # `mcp__<server>` ask. The author's deny keeps its position; derived rules append (deduped).
    config = ClaudeAgentTemplate(
        sandbox_permission=SandboxPermission(network={"mode": "off"}),
        harness_permissions={"default_mode": "plan"},
        mcp_servers=[
            {
                "name": "github",
                "transport": "http",
                "url": "https://x",
                "permission": "ask",
            }
        ],
    )
    payload = request_to_wire(
        harness=HarnessType.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["harnessFiles"][0]["path"] == ".claude/settings.json"
    settings = json.loads(payload["harnessFiles"][0]["content"])
    assert settings == {
        "permissions": {
            "defaultMode": "plan",
            "deny": ["WebFetch", "WebSearch"],
            "ask": ["mcp__github"],
        }
    }


def test_request_to_wire_carries_sandbox_permission_allowlist():
    # The allowlist mode rides the wire with its CIDR ranges and the default enforcement.
    config = PiAgentTemplate(
        sandbox_permission=SandboxPermission(
            network={"mode": "allowlist", "allowlist": ["10.0.0.0/8"]},
        )
    )
    payload = request_to_wire(
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
