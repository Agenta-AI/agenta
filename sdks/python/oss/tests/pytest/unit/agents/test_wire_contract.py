"""The ``/run`` wire contract: ``request_to_wire`` / ``result_from_wire``.

This is the highest-value regression guard in the agent runtime. ``wire.py`` (the Python
producer) and ``services/runner/src/protocol.ts`` (the TS consumer) are hand-mirrored, so the
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

from agenta.sdk.redaction.context import redaction_context
from agenta.sdk.redaction.redactor import Redactor

from agenta.sdk.agents import (
    AgentaAgentTemplate,
    AgentTemplate,
    ClaudeAgentTemplate,
    CodexAgentTemplate,
    ContentBlock,
    Endpoint,
    HarnessKind,
    Message,
    PiAgentTemplate,
    PiHarness,
    ResolvedConnection,
    RunContext,
    RunContextReference,
    RunContextRun,
    RunContextTrace,
    RunContextWorkflow,
    SandboxPermission,
    SessionConfig,
    SkillTemplate,
    ToolCallback,
    ToolResolver,
    TraceContext,
)
from agenta.sdk.agents.utils.effective_config import MAX_STAMPED_BYTES
from agenta.sdk.agents.utils.wire import (
    _ERROR_MAX_LEN,
    request_to_wire,
    result_from_wire,
    sanitize_runner_error,
)
from agenta.sdk.agents.wire_models import WireRunRequest
from agenta.sdk.agents.pi_builtins import PI_BUILTIN_TOOL_NAMES
from agenta.sdk.utils.types import build_agent_v0_default

# The full set of top-level keys ``request_to_wire`` may emit. THREE things must agree on it:
# this set, the ``WireRunRequest`` schema, and the TS ``AgentRunRequest`` interface. Adding a key
# to the producer without adding it here, or here without adding it to protocol.ts, is exactly
# the drift this set exists to catch.
#
# The schema half is checked structurally by ``test_known_request_keys_match_the_wire_schema``
# below, because a payload-validation test cannot catch it: ``_WireModel`` sets
# ``extra="allow"``, so a payload carrying a field the schema forgot still validates cleanly and
# the field silently becomes an extra. A generated client built from that schema would then drop
# it. That is how ``connection`` went missing once already.
KNOWN_REQUEST_KEYS = {
    "harness",
    "sandbox",
    "sessionId",
    "agentsMd",
    "model",
    "connection",
    "harnessMode",
    "modelCapabilities",
    "modelConnection",
    "messages",
    "context",
    "telemetry",
    "runContext",
    "tools",
    "customTools",
    "mcpServers",
    "toolCallback",
    "permissions",
    "systemPrompt",
    "appendSystemPrompt",
    "skills",
    "sandboxPermission",
    "harnessFiles",
    "turnId",
    "projectId",
    "effectiveParameters",
}

# The post-hydration config a session turn runs. Stamped on the wire so the runner can echo it
# onto a parked gate's interaction row (effective-turn-config plan, T1/T3).
_EFFECTIVE_PARAMETERS = {
    "agent": {
        "instructions": "You are a helpful assistant.",
        "llm": {"model": "openai-codex/gpt-5.5", "provider": "openai"},
        "runner": {"permissions": {"default": "allow_reads"}},
    }
}

_CUSTOM_TOOL = {
    "name": "get_user",
    "description": "Get a user",
    "inputSchema": {"type": "object", "properties": {}},
    "callRef": "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn",
    "kind": "callback",
    "contextBindings": {"target.workflow_variant_id": "$ctx.workflow.variant.id"},
    "timeoutMs": 120000,
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
        resolved_connection=ResolvedConnection(
            provider="openai-codex",
            model="gpt-5.5",
            deployment="direct",
            credential_mode="env",
            credentials=[
                {
                    "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                    "value": "sk-test",
                    "usage": "opaque_http",
                }
            ],
            endpoint=Endpoint(base_url="https://api.openai.com/v1"),
        ),
        custom_tools=[dict(_CUSTOM_TOOL), dict(_DIRECT_CALL_TOOL)],
        tool_callback=_CALLBACK,
        skills=[dict(_SKILL)],
        sandbox_permission=SandboxPermission(network={"mode": "off"}),
        system="You are Pi.",
        append_system="Be terse.",
    )
    return request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
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
            run=RunContextRun(kind="test"),
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
        effective_parameters=dict(_EFFECTIVE_PARAMETERS),
    )


def _claude_payload():
    config = ClaudeAgentTemplate(
        agents_md="You are a helpful assistant.",
        model="claude-sonnet-4-6",
        resolved_connection=ResolvedConnection(
            provider="anthropic",
            model="claude-sonnet-4-6",
            deployment="direct",
            credential_mode="env",
            credentials=[
                {
                    "binding": {
                        "kind": "environment",
                        "name": "ANTHROPIC_API_KEY",
                    },
                    "value": "sk-ant",
                    "usage": "opaque_http",
                }
            ],
            endpoint=Endpoint(base_url="https://api.anthropic.com"),
        ),
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        permission_default="deny",
        skills=[dict(_SKILL)],
        harness_permissions={
            "default_mode": "acceptEdits",
            "allow": ["Read", "Bash(npm run:*)"],
            "deny": ["WebFetch"],
        },
    )
    return request_to_wire(
        harness=HarnessKind.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        trace=None,
        run_context=RunContext(run=RunContextRun(kind="test")),
        session_id=None,
        # Deliberately supplied on a NON-session run: the gate is `session_id`, so this golden
        # pins that an ad-hoc run's payload carries no `effectiveParameters` (nothing will ever
        # park a gate against it, and the wire stays byte-identical to the pre-change contract).
        effective_parameters=dict(_EFFECTIVE_PARAMETERS),
    )


def _codex_payload():
    config = CodexAgentTemplate(
        agents_md="You are a helpful assistant.",
        model="gpt-5.6-luna",
        resolved_connection=ResolvedConnection(
            provider="openai",
            model="gpt-5.6-luna",
            deployment="direct",
            credential_mode="env",
            credentials=[
                {
                    "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                    "value": "sk-openai",
                    "usage": "opaque_http",
                }
            ],
            endpoint=Endpoint(base_url="https://api.openai.com/v1"),
        ),
    )
    return request_to_wire(
        harness=HarnessKind.CODEX,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
        trace=None,
        run_context=RunContext(run=RunContextRun(kind="test")),
        session_id=None,
    )


def _agenta_payload():
    config = AgentaAgentTemplate(
        agents_md="Agenta preamble + project rules.",
        model="gpt-5.5",
        custom_tools=[dict(_CUSTOM_TOOL)],
        tool_callback=_CALLBACK,
        append_system="You are an Agenta agent.",
        skills=[dict(_SKILL)],
    )
    return request_to_wire(
        harness=HarnessKind.AGENTA,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )


def _attachment_payload():
    config = PiAgentTemplate(
        agents_md="Use the attached file.",
        model="anthropic/claude-sonnet-4-6",
        resolved_connection=ResolvedConnection(
            provider="anthropic",
            model="claude-sonnet-4-6",
            credential_mode="runtime_provided",
            input_modalities=["text", "image"],
        ),
    )
    return request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[
            Message(
                role="user",
                content=[
                    ContentBlock(
                        type="attachment",
                        attachment_id="019c471b-5b91-71d2-9d4b-5486013e6e9b",
                        filename="photo.png",
                        mime_type="image/png",
                        size=482113,
                    ),
                    ContentBlock(type="text", text="Describe this image."),
                ],
            )
        ],
        session_id="sess-attachment",
    )


def test_request_to_wire_agenta_carries_skills_and_pi_shape():
    payload = _agenta_payload()
    assert set(payload) <= KNOWN_REQUEST_KEYS
    # Agenta is a Pi config: same tool shape and shared permission plan, plus prompt overrides.
    assert payload["permissions"] == {"default": "allow_reads"}
    assert payload["tools"] == list(PI_BUILTIN_TOOL_NAMES)
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
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "skills" not in payload


def test_request_to_wire_pi_matches_golden(golden):
    payload = _pi_payload()
    assert payload == golden("run_request.pi_core.json")
    # The callRef runner-only fields ride the wire for the executor, with camelCase names.
    assert payload["customTools"][0]["contextBindings"] == {
        "target.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    assert payload["customTools"][0]["timeoutMs"] == 120000
    # The Composio read-only hint rides the wire as camelCase `readOnly`.
    assert payload["customTools"][0]["readOnly"] is True
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
        "run": {"kind": "test"},
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


def test_request_to_wire_attachment_matches_golden(golden):
    payload = _attachment_payload()
    assert payload == golden("run_request.attachment.json")
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["modelCapabilities"] == {"inputModalities": ["text", "image"]}
    assert payload["messages"][0]["content"][0] == {
        "type": "attachment",
        "attachmentId": "019c471b-5b91-71d2-9d4b-5486013e6e9b",
        "filename": "photo.png",
        "mimeType": "image/png",
        "size": 482113,
    }


async def test_default_template_carries_no_tool_entries_and_still_names_every_builtin_on_the_wire(
    make_env,
):
    """Two guarantees at once, both of which a future edit could silently break.

    The shipped default template carries NO tool entries: built-ins are activated by the
    runner, never configured. And the wire's deprecated ``tools`` field still names every
    built-in, so an older runner that reads it as a grant list activates the same set instead
    of the empty list that caused issue #5590. This starts from the SHIPPED default rather than
    a hand-written template, and it runs the real chain (template parse, tool resolution, the Pi
    harness adapter, the wire serializer).
    """
    assert build_agent_v0_default()["tools"] == []

    template = AgentTemplate.from_params({"agent": build_agent_v0_default()})
    resolved = await ToolResolver().resolve(template.tools)
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = harness._to_harness_config(
        SessionConfig(
            agent=template,
            tool_specs=resolved.tool_specs,
        )
    )

    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )

    assert payload["tools"] == list(PI_BUILTIN_TOOL_NAMES)


def test_request_to_wire_omits_run_context_when_none():
    # No run context passed -> no `runContext` key (a run that needs no `call.context` binding stays
    # byte-identical to before, the same discipline skills/mcpServers/sandboxPermission use).
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "runContext" not in payload


def test_request_to_wire_omits_run_context_when_empty():
    # An entirely-empty run context (no identity to bind) serializes to {} and is dropped, so it
    # never rides the wire as a noise `"runContext": {}` key.
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        run_context=RunContext(),
    )
    assert "runContext" not in payload


def test_request_to_wire_carries_turn_id_when_set():
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        turn_id="turn-abc123",
    )
    assert payload["turnId"] == "turn-abc123"
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_omits_turn_id_when_none():
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "turnId" not in payload


def test_request_to_wire_carries_project_id_when_set():
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        project_id="proj-abc123",
    )
    assert payload["projectId"] == "proj-abc123"
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_omits_project_id_when_none():
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "projectId" not in payload


def test_request_to_wire_carries_effective_parameters_on_a_session_run():
    # The post-hydration config the turn runs, stamped so the runner can echo it onto a parked
    # gate's interaction row (effective-turn-config plan, T1).
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        session_id="sess-1",
        effective_parameters=dict(_EFFECTIVE_PARAMETERS),
    )
    assert payload["effectiveParameters"] == _EFFECTIVE_PARAMETERS
    assert set(payload) <= KNOWN_REQUEST_KEYS


def test_request_to_wire_omits_effective_parameters_without_a_session():
    # A non-session run can never park a gate, so the field is not emitted and the ad-hoc wire
    # stays byte-identical to the pre-change contract.
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        session_id=None,
        effective_parameters=dict(_EFFECTIVE_PARAMETERS),
    )
    assert "effectiveParameters" not in payload


def test_request_to_wire_omits_effective_parameters_when_empty():
    # Nothing to stamp -> no key (never a noise `"effectiveParameters": {}`).
    for empty in (None, {}):
        payload = request_to_wire(
            harness=HarnessKind.PI,
            sandbox="local",
            config=PiAgentTemplate(),
            messages=[Message(role="user", content="hi")],
            session_id="sess-1",
            effective_parameters=empty,
        )
        assert "effectiveParameters" not in payload


def test_effective_parameters_equal_the_post_hydration_config_either_way():
    """The stamped blob is whatever the handler ran with, on both invoke shapes.

    The resolver decides hydration purely from what the caller sent
    (``_caller_supplied_configuration``): a references-only invoke gets the hydrated revision's
    parameters, an inline-parameters invoke keeps the caller's. Either way the handler is
    handed ONE ``data.parameters`` dict, and that is exactly what reaches the wire — which is
    what makes a resume replaying the blob reproduce the turn.
    """
    hydrated = {"agent": {"llm": {"model": "anthropic/claude-haiku-4-5"}}}
    inline_draft = {"agent": {"llm": {"model": "anthropic/claude-sonnet-4-5"}}}

    for post_hydration in (hydrated, inline_draft):
        payload = request_to_wire(
            harness=HarnessKind.PI,
            sandbox="local",
            config=PiAgentTemplate(),
            messages=[Message(role="user", content="hi")],
            session_id="sess-1",
            effective_parameters=post_hydration,
        )
        assert payload["effectiveParameters"] == post_hydration


def test_effective_parameters_drop_mcp_connection_headers():
    # The one place the config schema permits a raw credential VALUE is an MCP server's static
    # `connection.headers`; the vault-key REFS under `credentials` survive so the replayed run
    # re-resolves the same secret.
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        session_id="sess-1",
        effective_parameters={
            "agent": {
                "mcps": [
                    {
                        "name": "notion",
                        "connection": {
                            "type": "http",
                            "url": "https://mcp.example/sse",
                            "headers": {"authorization": "Bearer sk-live-1234"},
                            "credentials": {
                                "type": "header_secret_refs",
                                "headers": {"authorization": "NOTION_TOKEN"},
                            },
                        },
                    }
                ]
            }
        },
    )
    connection = payload["effectiveParameters"]["agent"]["mcps"][0]["connection"]
    assert "headers" not in connection
    assert connection["url"] == "https://mcp.example/sse"
    assert connection["credentials"]["headers"] == {"authorization": "NOTION_TOKEN"}


def test_effective_parameters_preserve_tool_input_schema_properties():
    # Redaction is scoped to connection descriptors: a tool's JSON-Schema may legitimately
    # declare a property named `headers`, and mangling it would change the tool contract the
    # replayed run exposes to the model.
    tool = {
        "name": "http_get",
        "inputSchema": {
            "type": "object",
            "properties": {"headers": {"type": "object"}},
        },
    }
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        session_id="sess-1",
        effective_parameters={"agent": {"tools": [tool]}},
    )
    assert payload["effectiveParameters"]["agent"]["tools"][0] == tool


def test_effective_parameters_over_the_cap_are_dropped_whole():
    # A truncated config is invalid JSON and a silently-truncated one is worse than none, so an
    # oversize blob is not stamped at all (the resume degrades to reference hydration).
    oversize = {"agent": {"instructions": "x" * (MAX_STAMPED_BYTES + 1)}}
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
        session_id="sess-1",
        effective_parameters=oversize,
    )
    assert "effectiveParameters" not in payload


def test_request_to_wire_claude_matches_golden(golden):
    payload = _claude_payload()
    assert payload == golden("run_request.claude.json")
    # Claude carries the child run identity so reserved handlers can reject recursive test runs.
    assert payload["runContext"] == {"run": {"kind": "test"}}
    # No trace context threaded on this config: both role-separated keys are null (matching the
    # prior single `trace: null`), and the legacy `trace` key is gone.
    assert payload["context"] is None
    assert payload["telemetry"] is None
    assert "trace" not in payload
    # Claude-specific invariants the golden encodes, asserted explicitly so a failure reads clearly.
    assert payload["tools"] == []  # Claude has no Pi built-ins
    assert payload["permissions"] == {
        "default": "deny",
        "rules": [
            {"pattern": "WebFetch", "permission": "deny"},
            {"pattern": "Read", "permission": "allow"},
            {"pattern": "Bash(npm run:*)", "permission": "allow"},
        ],
    }
    assert "permissionPolicy" not in payload
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
    # Under a `deny` default, the unset resolved tool renders a deny rule for Claude's internal
    # `agenta-tools` MCP server.
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
                        ],
                        "deny": ["WebFetch", "mcp__agenta-tools__get_user"],
                    }
                },
                indent=2,
            ),
        }
    ]


def test_request_to_wire_codex_matches_golden(golden):
    payload = _codex_payload()
    assert payload == golden("run_request.codex.json")
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["harness"] == "codex"
    assert payload["tools"] == []  # Codex has no Pi built-ins
    assert payload["model"] == "gpt-5.6-luna"
    assert "harnessMode" not in payload
    assert payload["permissions"] == {"default": "allow_reads"}
    assert "permissionPolicy" not in payload
    assert "systemPrompt" not in payload  # Codex exposes no prompt overrides
    assert "appendSystemPrompt" not in payload
    # A managed codex run (credential_mode "env") renders config.toml carrying the file-free auth
    # provider block (env_key OPENAI_API_KEY), even with no authored options. The secret never
    # appears in the file; it rides `modelConnection.credentials` (D-002 final ruling).
    assert payload["harnessFiles"] == [
        {
            "path": ".codex/config.toml",
            "content": (
                'model_provider = "agenta-openai"\n'
                "\n[model_providers.agenta-openai]\n"
                'name = "Agenta OpenAI"\n'
                'env_key = "OPENAI_API_KEY"\n'
            ),
        }
    ]
    assert payload["modelConnection"]["credentials"] == [
        {
            "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
            "value": "sk-openai",
            "usage": "opaque_http",
        }
    ]
    assert payload["context"] is None
    assert payload["telemetry"] is None
    assert "trace" not in payload


def test_request_to_wire_codex_renders_config_toml_from_authored_options():
    # The Milestone 1 authoring schema does not yet carry these keys. That support lands in the
    # permissions milestone, so this test drives the pass-through directly to pin the rendering.
    # No resolved connection is threaded here, so the run defaults to MANAGED (file-free auth): the
    # config gains the `model_provider` pointer + the custom provider table (env_key OPENAI_API_KEY)
    # around the authored scalars (D-002 final ruling).
    config = CodexAgentTemplate(
        harness_permissions={
            "approval_policy": "untrusted",
            "sandbox_mode": "read-only",
        }
    )
    payload = request_to_wire(
        harness=HarnessKind.CODEX,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )

    assert payload["harnessFiles"] == [
        {
            "path": ".codex/config.toml",
            "content": (
                'model_provider = "agenta-openai"\n'
                'approval_policy = "untrusted"\n'
                'sandbox_mode = "read-only"\n'
                "\n[model_providers.agenta-openai]\n"
                'name = "Agenta OpenAI"\n'
                'env_key = "OPENAI_API_KEY"\n'
            ),
        }
    ]


def test_request_to_wire_codex_managed_is_file_free_provider_block():
    # A managed codex run (unresolved connection => managed) with nothing else authored still writes
    # config.toml carrying ONLY the file-free auth provider block. No credential appears in the file.
    config = CodexAgentTemplate(model="gpt-5.6-luna")
    payload = request_to_wire(
        harness=HarnessKind.CODEX,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert payload["harnessFiles"] == [
        {
            "path": ".codex/config.toml",
            "content": (
                'model_provider = "agenta-openai"\n'
                "\n[model_providers.agenta-openai]\n"
                'name = "Agenta OpenAI"\n'
                'env_key = "OPENAI_API_KEY"\n'
            ),
        }
    ]
    # No credential value ever appears in the file.
    assert "sk-openai" not in payload["harnessFiles"][0]["content"]


def test_request_to_wire_codex_subscription_renders_no_provider_block():
    # A subscription codex run (resolved credential_mode runtime_provided) uses the built-in provider
    # + its mounted OAuth login, so NO provider block is rendered. With nothing else authored, the
    # run stays fileless (byte-identical to before).
    from agenta.sdk.agents.connections.models import Connection, ResolvedConnection
    from agenta.sdk.agents.dtos import ModelRef

    config = CodexAgentTemplate(
        model="gpt-5.6-luna",
        model_ref=ModelRef(
            model="gpt-5.6-luna",
            provider="openai",
            connection=Connection(mode="self_managed", slug=None),
        ),
        resolved_connection=ResolvedConnection(
            provider="openai",
            model="gpt-5.6-luna",
            credential_mode="runtime_provided",
        ),
    )
    payload = request_to_wire(
        harness=HarnessKind.CODEX,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert "harnessFiles" not in payload


def test_author_permission_rules_exclude_mcp_from_wire_but_keep_settings():
    config = ClaudeAgentTemplate(
        harness_permissions={
            "deny": ["mcp__github__delete_issue", "Bash(rm:*)"],
            "ask": ["mcp__github__create_issue", "Write"],
            "allow": ["Read"],
        }
    )
    payload = request_to_wire(
        harness=HarnessKind.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )

    assert payload["permissions"] == {
        "default": "allow_reads",
        "rules": [
            {"pattern": "Bash(rm:*)", "permission": "deny"},
            {"pattern": "Write", "permission": "ask"},
            {"pattern": "Read", "permission": "allow"},
        ],
    }
    settings = json.loads(payload["harnessFiles"][0]["content"])
    assert settings["permissions"]["deny"] == [
        "mcp__github__delete_issue",
        "Bash(rm:*)",
    ]
    assert settings["permissions"]["ask"] == [
        "mcp__github__create_issue",
        "Write",
    ]
    assert settings["permissions"]["allow"] == ["Read"]


def test_request_to_wire_has_no_prompt_key():
    # The serializer emits `messages` only; the TS side derives the latest turn with
    # `resolvePromptText`. This asymmetry is intentional and easy to break, so lock it.
    payload = request_to_wire(
        harness=HarnessKind.PI,
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


def test_known_request_keys_match_the_wire_schema():
    """``WireRunRequest`` must declare exactly the keys the producer may emit.

    The subset guard above cannot catch a field the SCHEMA forgot, for two reasons. It only sees
    the keys the three sample payloads happen to carry, and ``_WireModel`` sets ``extra="allow"``,
    so even a payload that does carry the field validates cleanly with the field demoted to an
    extra. The schema is what generated clients are built from, so a field missing here is a
    field those clients drop.

    Equality, not a subset, in both directions: a key the schema declares and the producer never
    emits is dead contract surface that readers will assume is real.
    """
    declared = {
        field.alias or name for name, field in WireRunRequest.model_fields.items()
    }
    assert declared == KNOWN_REQUEST_KEYS


def test_named_connection_choice_is_a_declared_schema_field():
    """A named Agenta connection reaches the runner as a first-class field, not as an extra.

    The runner registers a custom OpenAI-compatible Pi run in Pi's ``models.json`` under a
    provider named after this slug (``pi-model-config.ts``), so a client that dropped the field
    would silently misroute those runs to the generic provider path.
    """
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(
            model={
                "provider": "openai",
                "model": "gpt-5.5",
                "connection": {"mode": "agenta", "slug": "openrouter-prod"},
            }
        ),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["connection"] == {"mode": "agenta", "slug": "openrouter-prod"}
    assert set(payload) <= KNOWN_REQUEST_KEYS

    parsed = WireRunRequest.model_validate(payload)
    assert parsed.connection is not None
    assert parsed.connection.slug == "openrouter-prod"
    # The point of the assertion: `connection` is a MODELLED field, so it survives a schema
    # round-trip. An extra would be dropped by `model_dump` without `serialize_as_any`.
    assert parsed.model_dump(by_alias=True, exclude_none=True)["connection"] == {
        "mode": "agenta",
        "slug": "openrouter-prod",
    }


def test_request_to_wire_carries_consumer_owned_model_connection():
    config = PiAgentTemplate(
        model="openai/gpt-5.5",
        resolved_connection=ResolvedConnection(
            provider="openai",
            model="gpt-5.5-2026",
            deployment="custom",
            credential_mode="env",
            credentials=[
                {
                    "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                    "value": "sk-secret",
                    "usage": "opaque_http",
                }
            ],
            endpoint=Endpoint(base_url="https://gw.example/v1"),
        ),
    )
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["model"] == "openai/gpt-5.5-2026"
    assert payload["modelConnection"] == {
        "provider": "openai",
        "deployment": "custom",
        "credentialMode": "env",
        "credentials": [
            {
                "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                "value": "sk-secret",
                "usage": "opaque_http",
            }
        ],
        "endpoint": {"baseUrl": "https://gw.example/v1"},
    }
    for removed in (
        "secrets",
        "provider",
        "connection",
        "deployment",
        "endpoint",
        "credentialMode",
    ):
        assert removed not in payload


@pytest.mark.parametrize(
    ("provider", "model", "expected"),
    [
        ("openai", "shared-model", "openai/shared-model"),
        ("openrouter", "shared-model", "openrouter/shared-model"),
        ("openrouter", "meta-llama/llama-3", "openrouter/meta-llama/llama-3"),
    ],
)
def test_pi_wire_model_preserves_resolved_provider(provider, model, expected):
    config = PiAgentTemplate(
        model=model,
        resolved_connection=ResolvedConnection(
            provider=provider,
            model=model,
            deployment="direct",
            credential_mode="runtime_provided",
        ),
    )
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert payload["model"] == expected


def test_claude_wire_model_keeps_bare_alias():
    config = ClaudeAgentTemplate(
        model="sonnet",
        resolved_connection=ResolvedConnection(
            provider="anthropic",
            model="sonnet",
            deployment="direct",
            credential_mode="runtime_provided",
        ),
    )
    payload = request_to_wire(
        harness=HarnessKind.CLAUDE,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert payload["model"] == "sonnet"


def test_request_to_wire_omits_resolved_connection_when_none():
    # No resolved connection -> no resolved-connection keys, so a config without one is
    # byte-identical to before (the golden contract; the golden fixtures set none).
    config = PiAgentTemplate(model="gpt-5.5")
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert config.wire_model_connection() == {}
    assert "modelConnection" not in payload
    assert payload["model"] == "gpt-5.5"


def test_pi_permissions_default_to_allow_reads():
    # Pi ships the same default permission plan as the other harnesses.
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["permissions"] == {"default": "allow_reads"}
    assert "permissionPolicy" not in payload


def test_result_from_wire_parses_ok(golden):
    result = result_from_wire(golden("run_result.ok.json"))

    assert result.output == "Hello!"
    assert [m.role for m in result.messages] == ["assistant"]
    # The event with no `type` is dropped on parse; the other three survive.
    assert [e.type for e in result.events] == ["message", "usage", "done"]
    assert result.events[0].data == {"type": "message", "text": "Hello!"}
    # The terminal `done` event carries the run's trace id (durable-replay link to the trace).
    assert result.events[2].data.get("traceId") == "trace-abc"
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
    # Reads the constant instead of a literal: the cap is a size bound that may be retuned, and a
    # hardcoded number here silently pins it (this test asserted 300 until the cap was raised).
    raw = "x" * (_ERROR_MAX_LEN + 700)
    result = sanitize_runner_error(raw)
    assert len(result) <= _ERROR_MAX_LEN
    assert result.endswith("…")


def test_sanitize_runner_error_keeps_a_long_actionable_message_whole():
    """A real runner error must arrive complete, because nothing downstream can recover the rest.

    The full text goes to the server log only. It is not on the trace and not on the wire, so a
    message cut here is unreadable for the user whatever the UI does (the error card already
    reveals everything it is given).
    """
    message = (
        "The runner refused the request: the Daytona API key cannot manage Secrets. "
        + "Grant that permission to the key in AGENTA_RUNNER_DAYTONA_API_KEY. " * 12
    ).strip()
    assert 300 < len(message) <= _ERROR_MAX_LEN

    result = sanitize_runner_error(message)

    assert result == message
    assert "…" not in result


def test_sanitize_runner_error_still_drops_a_stack_dump_after_the_first_line():
    # A long first line must not let the stack behind it through.
    raw = (
        "ValueError: "
        + "boom " * 200
        + '\n  File "/abs/secret/path.py", line 12, in run'
    )
    result = sanitize_runner_error(raw)

    assert "/abs/secret/path.py" not in result
    assert "File " not in result


def test_sanitize_runner_error_still_falls_back_on_a_long_stack_frame_first_line():
    raw = 'File "/abs/secret/path.py", line 12, in run - ' + "detail " * 200
    assert sanitize_runner_error(raw) == "agent run failed"


def test_sanitize_runner_error_still_redacts_a_known_secret_in_a_long_message():
    # The redactor runs last, so a secret cannot ride out inside the extra room the cap now allows.
    secret = "sk-runner-fake-secret-cccc3333cccc3333"
    message = (
        "The runner rejected the credential " + secret + ". Rotate it and retry. " * 40
    ).strip()
    assert len(message) <= _ERROR_MAX_LEN

    with redaction_context(Redactor().with_known_secrets([secret])):
        result = sanitize_runner_error(message)

    assert secret not in result
    assert "The runner rejected the credential" in result


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
    # (kind/runtime/code/env) and the orthogonal render axis; a client spec
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
                "url": "https://mcp.example.com/mcp",
                "headers": {"Authorization": "Bearer ghp"},
                "policy": {"tools": {"mode": "include", "names": ["create_issue"]}},
            }
        ],
    )
    payload = request_to_wire(
        harness=HarnessKind.PI,
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
    assert "needsApproval" not in code
    assert code["render"] == {"kind": "component", "component": "Calc"}
    client = next(t for t in payload["customTools"] if t["name"] == "pick")
    assert client["kind"] == "client"
    assert "callRef" not in client
    assert payload["mcpServers"] == [
        {
            "name": "github",
            "connection": {
                "type": "http",
                "url": "https://mcp.example.com/mcp",
                "headers": {"Authorization": "Bearer ghp"},
            },
            "policy": {"tools": {"mode": "include", "names": ["create_issue"]}},
        }
    ]


def test_request_to_wire_omits_mcp_servers_when_none():
    # No declared servers -> no `mcpServers` key (keeps a tool-free payload byte-identical).
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "mcpServers" not in payload


def test_request_to_wire_omits_sandbox_permission_when_none():
    # No declared boundary -> no `sandboxPermission` key (keeps a boundary-free payload
    # byte-identical, so existing configs/fixtures are unaffected).
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(),
        messages=[Message(role="user", content="hi")],
    )
    assert "sandboxPermission" not in payload


def test_request_to_wire_omits_harness_files_when_none():
    # No authored options on a Claude config -> the claude adapter renders nothing, so no
    # `harnessFiles` key (a Claude run without harness options is byte-identical to before).
    payload = request_to_wire(
        harness=HarnessKind.CLAUDE,
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
        harness=HarnessKind.PI,
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
                "url": "https://x",
                "policy": {"permission": "ask"},
            }
        ],
    )
    payload = request_to_wire(
        harness=HarnessKind.CLAUDE,
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
        harness=HarnessKind.PI,
        sandbox="local",
        config=config,
        messages=[Message(role="user", content="hi")],
    )
    assert set(payload) <= KNOWN_REQUEST_KEYS
    assert payload["sandboxPermission"] == {
        "network": {"mode": "allowlist", "allowlist": ["10.0.0.0/8"]},
        "enforcement": "strict",
    }


def test_permission_policy_absent_from_serialized_session_config():
    pi_payload = _pi_payload()
    claude_payload = _claude_payload()
    assert "permissionPolicy" not in json.dumps(pi_payload)
    assert "permissionPolicy" not in json.dumps(claude_payload)


def test_result_from_wire_redacts_seeded_credential_from_output_events_and_errors():
    marker = "sk-live-marker-12345678"
    redactor = Redactor().with_known_secrets([marker])
    with redaction_context(redactor):
        result = result_from_wire(
            {
                "ok": True,
                "output": f"echo {marker}",
                "messages": [{"role": "assistant", "content": marker}],
                "events": [{"type": "message", "content": marker}],
            }
        )
        assert marker not in result.output
        assert marker not in repr(result.messages)
        assert marker not in repr(result.events)
        with pytest.raises(RuntimeError) as exc:
            result_from_wire({"ok": False, "error": f"provider rejected {marker}"})
        assert marker not in str(exc.value)
