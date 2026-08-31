"""The platform-op catalog and its resolver (direct-call tools, Phase 3b).

A ``type:"platform"`` tool exposes an EXISTING Agenta endpoint to the agent. The catalog
(``op_catalog.py``) owns the description, the endpoint, the input schema, the run-context bindings,
and the per-op default permission/approval; the resolver (``AgentaPlatformToolResolver``) turns each
config into a ``CallbackToolSpec`` carrying a direct ``call`` descriptor (no ``/tools/call`` hop).

These tests cover: the catalog model's import-time validation, the resolver emitting a direct
``call`` (discover_tools), the self-update ``context_bindings`` stripping its bound field from the
model-visible schema, the catalog's permission/approval defaults and the config override, and the
error paths (unknown op, missing API base).
"""

from __future__ import annotations

import json
import logging
import os

import jsonschema
import pytest
from pydantic import ValidationError

import agenta.sdk.agents.platform.platform_tools as platform_tools_module

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import (
    PLATFORM_OPS,
    AgentaPlatformToolResolver,
    PlatformConnection,
    PlatformOp,
    get_platform_op,
)
from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolutionError,
    ToolCall,
    UnknownPlatformOpError,
)
from agenta.sdk.models.workflows import AGENT_SELF_NAMED_META_KEY


def _ordered_operations_enabled() -> bool:
    """Read the flag independently of the code under test.

    Calling the catalog's own helper would derive the expectation from the thing being
    asserted: a helper that always returned True would move both sides together and the
    test would still pass. The default and the spellings are spelled out here for the same
    reason.
    """
    value = (os.getenv("AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED") or "").strip()
    if not value:
        return True
    return value.lower() in {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


def _resolver(connection):
    return AgentaPlatformToolResolver(connection=connection)


# --- catalog model ------------------------------------------------------------


def test_catalog_ships_platform_builder_ops():
    # `read_config` ships only with ordered operations, so it is not in the always-on set.
    # Its own gating is pinned in test_read_config_op.py.
    assert set(PLATFORM_OPS) - {"read_config"} == {
        "discover_tools",
        "query_workflows",
        "query_spans",
        "rename_session",
        "rename_agent",
        "test_run",
        "commit_revision",
        "annotate_trace",
        "discover_triggers",
        "create_schedule",
        "create_subscription",
        "list_schedules",
        "list_subscriptions",
        "list_deliveries",
        "list_connections",
        "test_subscription",
        "remove_schedule",
        "remove_subscription",
        "pause_schedule",
        "resume_schedule",
        "pause_subscription",
        "resume_subscription",
    }


def test_reserved_id_uses_the_tools_agenta_namespace():
    # Mirrors the reserved `tools.agenta.discover_tools` precedent (PR #4884).
    assert get_platform_op("discover_tools").reserved_id == (
        "tools.agenta.discover_tools"
    )


def test_op_requires_exactly_one_schema_source():
    with pytest.raises(ValidationError):
        PlatformOp(op="x", description="d", method="POST", path="/api/x")
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            input_schema_ref="messages",
        )


def test_catalog_op_may_declare_put():
    op = PlatformOp(
        op="x",
        description="d",
        method="PUT",
        path="/api/x",
        input_schema={"type": "object"},
    )
    assert op.method == "PUT"


def test_op_input_schema_ref_must_be_a_known_catalog_key():
    with pytest.raises(ValidationError, match="CATALOG_TYPES"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema_ref="not-a-real-type",
        )


def test_op_requires_exactly_one_target_mode():
    with pytest.raises(ValidationError, match="method.*path.*handler"):
        PlatformOp(op="x", description="d", input_schema={"type": "object"})
    with pytest.raises(ValidationError, match="method.*path.*handler"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            handler="tools.agenta.test_run",
            input_schema={"type": "object"},
        )
    with pytest.raises(ValidationError, match="method.*path"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            input_schema={"type": "object"},
        )


def test_op_handler_must_be_allowlisted():
    with pytest.raises(ValidationError, match="allowlisted"):
        PlatformOp(
            op="x",
            description="d",
            handler="tools.agenta.unknown",
            input_schema={"type": "object"},
        )
    # The allowlist is an exact match, not a prefix match: an extension of an
    # allowlisted ref is still rejected.
    with pytest.raises(ValidationError, match="allowlisted"):
        PlatformOp(
            op="x",
            description="d",
            handler="tools.agenta.test_run_extra",
            input_schema={"type": "object"},
        )


def test_op_input_schema_ref_resolves_against_the_catalog():
    # A whole-op schema named by a CATALOG_TYPES key expands to that concrete type (no marker left).
    op = PlatformOp(
        op="x",
        description="d",
        method="POST",
        path="/api/x",
        input_schema_ref="messages",
    )
    schema = op.resolved_input_schema()
    assert "x-ag-type-ref" not in schema
    # `messages` is an array catalog type; expansion yields its concrete structure.
    assert schema.get("type") == "array"


def test_op_path_must_be_a_single_absolute_path():
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="api/x",
            input_schema={"type": "object"},
        )
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="//evil",
            input_schema={"type": "object"},
        )


def test_op_context_binding_token_must_be_a_ctx_reference():
    with pytest.raises(ValidationError, match=r"\$ctx"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            context_bindings={"field": "workflow.variant.id"},  # missing $ctx. prefix
        )


def test_unknown_op_raises_typed_error():
    with pytest.raises(UnknownPlatformOpError) as caught:
        get_platform_op("does_not_exist")
    assert caught.value.op == "does_not_exist"
    # The available ops are listed so the message is actionable.
    assert "discover_tools" in str(caught.value)


# --- resolver: discover_tools emits a direct call --------------------------


async def test_discover_tools_emits_a_direct_call(connection):
    # THE deferred item (PR #4884): discover_tools becomes agent-usable as a direct call to
    # POST /api/tools/discover, instead of the server-side /tools/call tools.agenta.* dispatch.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    assert len(resolution.tool_specs) == 1
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.name == "discover_tools"
    # A direct call, NOT a gateway call_ref (the `call` XOR `call_ref` rule).
    assert spec.call_ref is None
    assert spec.call is not None
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/tools/discover"
    assert spec.call.context is None  # no run-context binding for a plain read
    # The model-visible input schema is the discover request contract.
    assert set(spec.input_schema["properties"]) == {
        "use_cases",
        "provider",
        "limit_alternatives",
    }
    assert spec.input_schema["required"] == ["use_cases"]
    assert spec.read_only is True
    assert spec.effective_permission() is None
    # The shared callback gives the runner the origin to resolve the relative path against.
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolution.tool_callback.authorization == "Access tok"


async def test_discover_tools_wire_carries_call_not_call_ref(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    wire = resolution.tool_specs[0].to_wire()
    assert wire["kind"] == "callback"
    assert "callRef" not in wire
    assert wire["call"]["path"] == "/api/tools/discover"


async def test_rename_session_emits_a_bound_direct_call(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="rename_session")]
    )
    spec = resolution.tool_specs[0]

    assert isinstance(spec, CallbackToolSpec)
    assert spec.kind == "callback"
    assert spec.name == "rename_session"
    assert spec.call_ref is None
    assert isinstance(spec.call, ToolCall)
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/sessions/streams/header?session_id={session_id}"
    assert spec.call.context == {"session_id": "$ctx.session.id"}
    assert spec.read_only is False

    schema = get_platform_op("rename_session").resolved_input_schema()
    assert set(schema["properties"]) == {"name", "description"}
    assert schema["required"] == ["name"]
    assert spec.input_schema == schema

    wire = spec.to_wire()
    assert wire["call"]["path"] == spec.call.path
    assert wire["call"]["context"] == {"session_id": "$ctx.session.id"}


def test_rename_session_rejects_whitespace_only_name():
    schema = get_platform_op("rename_session").resolved_input_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"name": "   "}, schema)


async def test_rename_agent_emits_a_bound_handler_call(connection, fake_http):
    fake_http(
        platform_tools_module,
        payload={"workflow": {"name": "Untitled agent", "meta": {}}},
    )
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="rename_agent")],
        workflow_id="21f1e7dc-85f8-4a55-8ae7-1bf5dcd7350d",
    )
    spec = resolution.tool_specs[0]

    assert isinstance(spec, CallbackToolSpec)
    assert spec.kind == "callback"
    assert spec.name == "rename_agent"
    assert spec.call is None
    assert spec.call_ref == "tools.agenta.rename_agent"
    assert spec.context_bindings == {
        "workflow_id": "$ctx.workflow.artifact.id",
    }
    assert spec.read_only is False

    schema = get_platform_op("rename_agent").resolved_input_schema()
    assert set(schema["properties"]) == {"name", "description"}
    assert "workflow_id" not in schema["properties"]
    assert schema["required"] == ["name"]
    assert spec.input_schema == schema

    wire = spec.to_wire()
    assert wire["callRef"] == "tools.agenta.rename_agent"
    assert wire["contextBindings"] == spec.context_bindings
    assert "call" not in wire


async def test_rename_agent_is_omitted_without_a_running_workflow(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="rename_agent")]
    )

    assert resolution.tool_specs == []


async def test_rename_agent_description_includes_current_persisted_name(
    connection, fake_http
):
    capture = fake_http(
        platform_tools_module,
        payload={"workflow": {"name": "Build a support bot", "meta": {}}},
    )

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="rename_agent")],
        workflow_id="21f1e7dc-85f8-4a55-8ae7-1bf5dcd7350d",
    )

    assert len(resolution.tool_specs) == 1
    assert (
        'Current persisted agent name: "Build a support bot".'
        in resolution.tool_specs[0].description
    )
    assert capture == {
        "method": "GET",
        "url": ("https://api.x/api/workflows/21f1e7dc-85f8-4a55-8ae7-1bf5dcd7350d"),
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Access tok",
        },
    }


async def test_rename_agent_is_removed_after_first_success(connection, fake_http):
    fake_http(
        platform_tools_module,
        payload={
            "workflow": {
                "name": "Support Triage",
                "meta": {AGENT_SELF_NAMED_META_KEY: True},
            }
        },
    )

    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(op="rename_agent"),
            PlatformToolConfig(op="rename_session"),
        ],
        workflow_id="21f1e7dc-85f8-4a55-8ae7-1bf5dcd7350d",
    )

    assert [spec.name for spec in resolution.tool_specs] == ["rename_session"]


def test_rename_agent_rejects_whitespace_only_name():
    schema = get_platform_op("rename_agent").resolved_input_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"name": "   "}, schema)


def test_rename_agent_description_stops_after_first_successful_rename():
    description = get_platform_op("rename_agent").description
    assert "available only until the first successful rename" in description
    assert "current persisted name" in description
    assert "removes this tool from later runs" in description
    assert "purpose changes" not in description


async def test_test_run_emits_handler_call_ref_with_bindings_and_timeout_by_default(
    connection,
):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="test_run")]
    )
    spec = resolution.tool_specs[0]

    assert spec.kind == "callback"
    assert spec.name == "test_run"
    assert spec.call is None
    assert spec.call_ref == "tools.agenta.test_run"
    assert spec.context_bindings == {
        "target.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    assert spec.timeout_ms == 120000
    assert spec.read_only is False
    assert spec.effective_permission() is None
    assert "target" not in spec.input_schema["properties"]
    # `description` is the ephemeral per-call note every builder op offers (R12); the runner
    # strips it before it builds the request. See test_op_catalog_description.py.
    assert set(spec.input_schema["properties"]) == {
        "inputs",
        "delta",
        "expectations",
        "description",
    }
    assert spec.input_schema["required"] == ["inputs"]
    assert spec.input_schema["properties"]["inputs"]["required"] == ["messages"]
    # The verdict enum is spelled out in the description so its meaning survives even when
    # the skill is not loaded (see docs/design/.../part-3-agenta-skills-sync.md, B5).
    for verdict_word in ("pass", "incomplete", "unconfirmed", "failed"):
        assert verdict_word in spec.description

    wire = spec.to_wire()
    assert wire["callRef"] == "tools.agenta.test_run"
    assert wire["contextBindings"] == {
        "target.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    assert wire["timeoutMs"] == 120000
    assert "call" not in wire


@pytest.mark.parametrize(
    "disabled_value",
    ["false", "0", "f", "n", "no", "off", "disable", "disabled", " OFF "],
)
async def test_platform_handlers_flag_off_skips_handler_ops_and_keeps_endpoint_ops(
    connection, monkeypatch, caplog, disabled_value
):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", disabled_value)
    caplog.set_level(logging.WARNING)

    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(op="test_run"),
            PlatformToolConfig(op="discover_tools"),
        ]
    )

    assert [spec.name for spec in resolution.tool_specs] == ["discover_tools"]
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert "skipping platform handler-mode op 'test_run'" in caplog.text
    assert "AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS" in caplog.text


async def test_handlers_flag_off_skips_rename_without_reading_state(
    connection, monkeypatch, caplog, fake_http
):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")
    caplog.set_level(logging.WARNING)
    capture = fake_http(
        platform_tools_module,
        payload={"workflow": {"name": "Untitled agent", "meta": {}}},
    )

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="rename_agent")],
        workflow_id="21f1e7dc-85f8-4a55-8ae7-1bf5dcd7350d",
    )

    assert resolution.tool_specs == []
    assert capture == {}
    assert "AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS" in caplog.text


async def test_platform_handlers_empty_flag_uses_default_on(connection, monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "")

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="test_run")]
    )

    assert [spec.name for spec in resolution.tool_specs] == ["test_run"]


async def test_query_spans_emits_project_scoped_read_call(connection):
    # Project scoping comes from the caller credential on the endpoint; there is no target field
    # for the model to supply and no run-context binding to inject.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="query_spans")]
    )
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.name == "query_spans"
    assert spec.call_ref is None
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/spans/query"
    assert spec.call.context is None
    assert spec.read_only is True
    assert spec.effective_permission() is None

    assert set(spec.input_schema["properties"]) == {
        "filtering",
        "windowing",
        "query_ref",
        "query_variant_ref",
        "query_revision_ref",
    }
    assert "required" not in spec.input_schema
    assert {
        "focus",
        "format",
        "filter",
        "oldest",
        "newest",
        "limit",
        "rate",
    }.isdisjoint(spec.input_schema["properties"])

    defs = spec.input_schema["$defs"]
    filtering_schema = defs["Filtering"]
    assert set(filtering_schema["properties"]) == {"operator", "conditions"}
    condition_ref = filtering_schema["properties"]["conditions"]["items"]["anyOf"][0]
    assert condition_ref == {"$ref": "#/$defs/Condition"}
    condition_schema = defs["Condition"]
    assert set(condition_schema["properties"]) == {
        "field",
        "key",
        "value",
        "operator",
        "options",
    }
    assert condition_schema["required"] == ["field"]
    assert "trace_id" in condition_schema["properties"]["field"]["description"]

    assert set(defs["Windowing"]["properties"]) == {
        "newest",
        "oldest",
        "next",
        "limit",
        "order",
        "interval",
        "rate",
    }


# --- resolver: commit_revision self-update binds + strips ---------------------


async def test_commit_revision_binds_self_and_strips_bound_field(connection):
    # "Update myself": the running variant id is bound from run context and stripped from the
    # model-visible schema, so the model supplies only the payload and can never retarget.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    # Handler mode: there is no scoped route any more. The confinement to `parameters.agent`
    # is a property of the handler this call_ref names, and it is unforgeable for the same
    # reason the route was: the ref comes from this catalog, the runner calls from outside
    # the sandbox, and the sandbox holds no credential.
    assert spec.call_ref == "tools.agenta.commit_revision"
    assert spec.call is None
    # The binding rides as a spec-level context binding the relay injects at dispatch.
    assert spec.context_bindings == {
        "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    # The bound field is gone from the model-visible schema (and its `required`); the payload fields
    # the model SHOULD supply remain.
    workflow_revision = spec.input_schema["properties"]["workflow_revision"]
    assert "workflow_variant_id" not in workflow_revision["properties"]
    # The ordered arm REQUIRES the base revision id: the server refuses a delta that omits
    # it, so a schema that marks it optional buys a refused call and a wasted turn. Its
    # absence from the flag-off list is equally deliberate: a legacy delta may omit it, and
    # sending it is how a caller opts in to the staleness check.
    assert workflow_revision["required"] == (
        ["base_revision_id", "delta"] if _ordered_operations_enabled() else ["delta"]
    )
    delta = workflow_revision["properties"]["delta"]

    # The rest of the surface depends on the ordered-operations flag: with it on, the
    # server derives the message and the ordered arm appears. Both states are pinned, so
    # this test is honest whichever way the suite runs.
    # `description` is the ephemeral per-call note in its tolerated second position, not a
    # payload field: the runner lifts it out and it is never stored (read-config.md 12).
    if _ordered_operations_enabled():
        assert set(workflow_revision["properties"]) == {
            "base_revision_id",
            "delta",
            "description",
        }
        # ONE arm is visible per deployment. A model that sees both picks a different one
        # from call to call, and the approval card then varies for the same kind of edit.
        # The endpoint still accepts the legacy form; only this surface narrows.
        assert set(delta["properties"]) == {"operations"}
    else:
        assert set(workflow_revision["properties"]) == {
            "message",
            "delta",
            "description",
        }
        assert set(delta["properties"]) == {"set", "remove"}
        assert "parameters.agent" in delta["properties"]["set"]["description"]

    if _ordered_operations_enabled():
        # Ordered operations change one entry at a time, so the wholesale-list warning is
        # obsolete; the description teaches the read-then-commit loop instead.
        assert "base_revision_id" in spec.description
        assert "playground's own tools" in spec.description
    else:
        # Lists (tools, skills, mcps) replace wholesale on deep-merge; the description must
        # warn the model to resend the complete list or it wipes its own build-kit tools (B2).
        assert "wholesale" in spec.description
        assert "revision id" in spec.description


async def test_commit_revision_is_not_read_only(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() is None


# --- delta.set carries the typed agent-template shape -------------------------


def _iter_required_lists(node):
    """Yield every JSON-Schema `required` array reachable under `node`."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "required" and isinstance(value, list):
                yield value
            else:
                yield from _iter_required_lists(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_required_lists(item)


def _has_embed_branch(items):
    """True when a list-item schema accepts the `@ag.embed` object alternative."""
    branches = items.get("anyOf") if isinstance(items, dict) else None
    if not isinstance(branches, list):
        return False
    return any(
        isinstance(branch, dict)
        and isinstance(branch.get("properties"), dict)
        and "@ag.embed" in branch["properties"]
        for branch in branches
    )


# With ordered operations on, `delta.set` leaves the commit schema, so the three cases below
# have no surface to inspect there. They are not lost: `test_run` keeps `delta.set` in both
# states, and case (d) pins the same three properties on it.
legacy_delta_only = pytest.mark.skipif(
    _ordered_operations_enabled(),
    reason="delta.set is not model-visible on commit_revision when ordered operations are on",
)


def _commit_agent_subtree():
    schema = get_platform_op("commit_revision").resolved_input_schema()
    delta = schema["properties"]["workflow_revision"]["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


def _test_run_agent_subtree():
    schema = get_platform_op("test_run").resolved_input_schema()
    delta = schema["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


@legacy_delta_only
def test_commit_revision_delta_set_carries_agent_template_shape():
    # (a) The agent-template shape is reachable under delta.set.parameters.agent, so the tool schema
    # itself (not just prose) tells the model what a `parameters.agent` payload looks like. The
    # harness `kind` enum is a concrete, low-drift landmark inside it.
    agent = _commit_agent_subtree()
    assert agent["type"] == "object"
    assert set(agent["properties"]) >= {
        "instructions",
        "llm",
        "tools",
        "mcps",
        "skills",
        "harness",
        "runner",
        "sandbox",
    }
    harness_kind = agent["properties"]["harness"]["properties"]["kind"]
    assert "pi_core" in harness_kind["enum"]
    assert "claude" in harness_kind["enum"]
    # The inline skill-template ref was expanded (its typed fields are present), not left as a marker.
    skills_items = agent["properties"]["skills"]["items"]
    assert "x-ag-type-ref" not in json.dumps(agent)
    assert _has_embed_branch(skills_items)


@legacy_delta_only
def test_commit_revision_delta_set_agent_subtree_has_no_required():
    # (b) A delta is a deep partial: EVERY field is optional, so no `required` array may survive
    # anywhere under the agent subtree, or a schema-following harness would think it must resend
    # every required field just to change one.
    agent = _commit_agent_subtree()
    assert list(_iter_required_lists(agent)) == []


@legacy_delta_only
def test_commit_revision_delta_set_list_items_accept_embeds():
    # (c) tools/skills/mcps may hold `@ag.embed` build-kit entries; since the model re-sends the
    # whole list, each item schema must accept the embed shape or the embeds get mangled.
    agent = _commit_agent_subtree()
    for field in ("tools", "skills", "mcps"):
        items = agent["properties"][field]["items"]
        assert "anyOf" in items, field
        assert _has_embed_branch(items), field


def test_test_run_delta_set_matches_commit_revision():
    # (d) test_run's uncommitted delta gets the same typed, deep-partial, embed-tolerant shape.
    # With ordered operations on this is the only place that shape is pinned, because
    # `delta.set` is no longer model-visible on commit_revision.
    agent = _test_run_agent_subtree()
    assert set(agent["properties"]) >= {"instructions", "llm", "harness", "sandbox"}
    assert "pi_core" in agent["properties"]["harness"]["properties"]["kind"]["enum"]
    assert list(_iter_required_lists(agent)) == []
    for field in ("tools", "skills", "mcps"):
        assert _has_embed_branch(agent["properties"][field]["items"]), field


def test_commit_revision_resolved_schema_size_is_bounded():
    # (e) Guard against runaway expansion (a self-referential or duplicated type-ref could blow the
    # schema up and the tools/list payload with it). A generous cap still catches an explosion.
    schema = get_platform_op("commit_revision").resolved_input_schema()
    size = len(json.dumps(schema))
    assert size < 200_000, size


# --- resolver: annotate_trace self-targets its own trace/span -----------------


async def test_annotate_trace_binds_own_trace_and_hides_links(connection):
    # "Grade myself": the run's own trace_id/span_id are bound from run context and never
    # model-supplied, so the agent can only ever annotate its OWN current trace.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="annotate_trace")]
    )
    spec = resolution.tool_specs[0]
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/annotations/"
    assert spec.call.args_into == "annotation"
    # Both self-target ids ride as call.context — the runner fills them from runContext at dispatch.
    assert spec.call.context == {
        "annotation.links.invocation.trace_id": "$ctx.trace.trace_id",
        "annotation.links.invocation.span_id": "$ctx.trace.span_id",
    }
    # The model supplies only the payload (an evaluator slug + the outputs); `links` is never
    # exposed, and the schema is closed so the model cannot smuggle its own target.
    props = spec.input_schema["properties"]
    assert set(props) == {"references", "data"}
    assert "links" not in props
    assert spec.input_schema["additionalProperties"] is False
    assert props["references"]["properties"]["evaluator"]["required"] == ["slug"]
    assert props["data"]["properties"]["outputs"]["additionalProperties"] is True


async def test_annotate_trace_is_not_read_only(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="annotate_trace")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() is None


async def test_trigger_builder_ops_have_expected_paths_and_defaults(connection):
    expected_paths = {
        "discover_triggers": ("POST", "/api/triggers/discover"),
        "create_schedule": ("POST", "/api/triggers/schedules/"),
        "create_subscription": ("POST", "/api/triggers/subscriptions/"),
        "list_schedules": ("GET", "/api/triggers/schedules/"),
        "list_subscriptions": ("GET", "/api/triggers/subscriptions/"),
        "list_deliveries": ("GET", "/api/triggers/deliveries"),
        "list_connections": ("POST", "/api/triggers/connections/query"),
        "test_subscription": ("POST", "/api/triggers/subscriptions/test"),
        "remove_schedule": ("DELETE", "/api/triggers/schedules/{id}"),
        "remove_subscription": ("DELETE", "/api/triggers/subscriptions/{id}"),
        "pause_schedule": ("POST", "/api/triggers/schedules/{id}/stop"),
        "resume_schedule": ("POST", "/api/triggers/schedules/{id}/start"),
        "pause_subscription": ("POST", "/api/triggers/subscriptions/{id}/stop"),
        "resume_subscription": ("POST", "/api/triggers/subscriptions/{id}/start"),
    }
    read_only = {
        "discover_triggers",
        "list_schedules",
        "list_subscriptions",
        "list_deliveries",
        "list_connections",
    }

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op=op) for op in expected_paths]
    )
    specs = {spec.name: spec for spec in resolution.tool_specs}

    for name, (method, path) in expected_paths.items():
        assert specs[name].call.method == method
        assert specs[name].call.path == path
        assert specs[name].read_only is (name in read_only)
        assert specs[name].effective_permission() is None


async def test_create_trigger_ops_bind_self_target_and_hide_destination(connection):
    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(op="create_schedule"),
            PlatformToolConfig(op="create_subscription"),
        ]
    )
    specs = {spec.name: spec for spec in resolution.tool_specs}

    schedule = specs["create_schedule"]
    assert schedule.call.args_into == "schedule"
    assert schedule.call.context == {
        "schedule.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
    }
    schedule_data_props = schedule.input_schema["properties"]["data"]["properties"]
    assert "references" not in schedule_data_props
    assert "selector" not in schedule_data_props
    # Un-pinned triggers bind to the variant's latest revision at creation and do not follow
    # later commits (A1/B2): the description must say so.
    assert "latest revision" in schedule.description
    inputs_fields_description = schedule_data_props["inputs_fields"]["description"]
    assert "JSON Path" in inputs_fields_description
    assert "JSON Pointer" in inputs_fields_description

    subscription = specs["create_subscription"]
    assert subscription.call.args_into == "subscription"
    assert subscription.call.context == {
        "subscription.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
    }
    data_props = subscription.input_schema["properties"]["data"]["properties"]
    assert "references" not in data_props
    assert "selector" not in data_props
    assert "latest revision" in subscription.description
    assert data_props["inputs_fields"]["description"] == inputs_fields_description


async def test_config_permission_rides_with_catalog_read_only_hint(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision", permission="allow")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() == "allow"


# --- resolver: error paths ----------------------------------------------------


async def test_unknown_op_in_config_raises(connection):
    with pytest.raises(UnknownPlatformOpError):
        await _resolver(connection).resolve([PlatformToolConfig(op="nope")])


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve([PlatformToolConfig(op="discover_tools")])


async def test_duplicate_platform_tool_rejected(connection):
    with pytest.raises(GatewayToolResolutionError, match="Duplicate platform tool"):
        await _resolver(connection).resolve(
            [
                PlatformToolConfig(op="discover_tools"),
                PlatformToolConfig(op="discover_tools"),
            ]
        )


# --- the kill switch, and what it may and may not take away ------------------


async def test_disabling_handlers_still_skips_the_optional_op(connection, monkeypatch):
    # `test_run` is genuinely optional: an agent without it loses a convenience and can
    # still do its job, so the switch keeps degrading it quietly.
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="test_run")]
    )

    assert resolution.tool_specs == []


@pytest.mark.parametrize("op", ["commit_revision", "read_config"])
async def test_disabling_handlers_cannot_silently_remove_config_editing(
    connection, monkeypatch, op
):
    # The asymmetry that matters: skipping an optional op is a degradation; skipping the
    # only transport for a core capability is an outage wearing a warning's clothes.
    #
    # Dropped silently, the model has no commit tool AND no error to report, so it
    # improvises: it writes workspace files and says it succeeded. That is the exact
    # failure this whole feature exists to prevent, so it fails at resolution instead.
    if op == "read_config" and not _ordered_operations_enabled():
        # `read_config` enters the catalog only with ordered operations on, which is the
        # flag gating this whole surface. `commit_revision` does NOT (it is in the build
        # kit unconditionally), which is why that half of this cell runs in both states and
        # is the one that decides the upgrade blast radius.
        pytest.skip("read_config is not in the catalog with ordered operations off")

    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")

    with pytest.raises(GatewayToolResolutionError) as caught:
        await _resolver(connection).resolve([PlatformToolConfig(op=op)])

    message = str(caught.value)
    # What happened, what it cost, and the one-step fix.
    assert "AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS" in message
    assert op in message
    assert "Unset" in message


async def test_the_switch_left_alone_changes_nothing(connection, monkeypatch):
    # Unset means enabled, so the overwhelmingly common deployment is untouched.
    monkeypatch.delenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", raising=False)

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )

    assert resolution.tool_specs[0].call_ref == "tools.agenta.commit_revision"
