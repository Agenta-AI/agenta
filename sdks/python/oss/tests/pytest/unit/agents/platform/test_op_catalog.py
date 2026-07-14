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

import pytest
from pydantic import ValidationError

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import (
    PLATFORM_OPS,
    AgentaPlatformToolResolver,
    PlatformConnection,
    PlatformOp,
    get_platform_op,
)
from agenta.sdk.agents.tools import GatewayToolResolutionError, UnknownPlatformOpError


def _resolver(connection):
    return AgentaPlatformToolResolver(connection=connection)


# --- catalog model ------------------------------------------------------------


def test_catalog_ships_platform_builder_ops():
    assert set(PLATFORM_OPS) == {
        "discover_tools",
        "query_workflows",
        "query_spans",
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
    assert set(spec.input_schema["properties"]) == {
        "inputs",
        "delta",
        "expectations",
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
    assert spec.call.path == "/api/workflows/revisions/commit"
    # The context binding rides as call.context — the runner fills it from runContext at dispatch.
    assert spec.call.context == {
        "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    # The bound field is gone from the model-visible schema (and its `required`); the payload fields
    # the model SHOULD supply remain.
    workflow_revision = spec.input_schema["properties"]["workflow_revision"]
    assert "workflow_variant_id" not in workflow_revision["properties"]
    assert set(workflow_revision["properties"]) == {"message", "delta"}
    assert workflow_revision["required"] == ["delta"]
    delta = workflow_revision["properties"]["delta"]
    assert set(delta["properties"]) == {"set", "remove"}
    assert "parameters.agent" in delta["properties"]["set"]["description"]
    # Lists (tools, skills, mcps) replace wholesale on deep-merge; the description must warn
    # the model to resend the complete list or it wipes its own build-kit tools (B2).
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


def _commit_agent_subtree():
    schema = get_platform_op("commit_revision").resolved_input_schema()
    delta = schema["properties"]["workflow_revision"]["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


def _test_run_agent_subtree():
    schema = get_platform_op("test_run").resolved_input_schema()
    delta = schema["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


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


def test_commit_revision_delta_set_agent_subtree_has_no_required():
    # (b) A delta is a deep partial: EVERY field is optional, so no `required` array may survive
    # anywhere under the agent subtree, or a schema-following harness would think it must resend
    # every required field just to change one.
    agent = _commit_agent_subtree()
    assert list(_iter_required_lists(agent)) == []


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
