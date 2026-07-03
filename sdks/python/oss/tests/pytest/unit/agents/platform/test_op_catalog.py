"""The platform-op catalog and its resolver (direct-call tools, Phase 3b).

A ``type:"platform"`` tool exposes an EXISTING Agenta endpoint to the agent. The catalog
(``op_catalog.py``) owns the description, the endpoint, the input schema, the run-context bindings,
and the per-op default permission/approval; the resolver (``AgentaPlatformToolResolver``) turns each
config into a ``CallbackToolSpec`` carrying a direct ``call`` descriptor (no ``/tools/call`` hop).

These tests cover: the catalog model's import-time validation, the resolver emitting a direct
``call`` (find_capabilities), the self-update ``context_bindings`` stripping its bound field from the
model-visible schema, the catalog's permission/approval defaults and the config override, and the
error paths (unknown op, missing API base).
"""

from __future__ import annotations

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
        "find_capabilities",
        "query_workflows",
        "commit_revision",
        "annotate_trace",
        "find_triggers",
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
    # Mirrors the reserved `tools.agenta.find_capabilities` precedent (PR #4884).
    assert get_platform_op("find_capabilities").reserved_id == (
        "tools.agenta.find_capabilities"
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
    assert "find_capabilities" in str(caught.value)


# --- resolver: find_capabilities emits a direct call --------------------------


async def test_find_capabilities_emits_a_direct_call(connection):
    # THE deferred item (PR #4884): find_capabilities becomes agent-usable as a direct call to
    # POST /api/tools/discover, instead of the server-side /tools/call tools.agenta.* dispatch.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="find_capabilities")]
    )
    assert len(resolution.tool_specs) == 1
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.name == "find_capabilities"
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
    # A read op defaults to auto-allow and no approval.
    assert spec.needs_approval is False
    assert spec.effective_permission() == "allow"
    # The shared callback gives the runner the origin to resolve the relative path against.
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolution.tool_callback.authorization == "Access tok"


async def test_find_capabilities_wire_carries_call_not_call_ref(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="find_capabilities")]
    )
    wire = resolution.tool_specs[0].to_wire()
    assert wire["kind"] == "callback"
    assert "callRef" not in wire
    assert wire["call"]["path"] == "/api/tools/discover"


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


async def test_commit_revision_defaults_to_approval(connection):
    # A mutating op defaults to needs_approval=True -> effective `ask` (self-update is gated).
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    assert spec.needs_approval is True
    assert spec.effective_permission() == "ask"


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


async def test_annotate_trace_defaults_to_auto_allow(connection):
    # Additive self-metadata (does not mutate config) -> auto-allow, no approval.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="annotate_trace")]
    )
    spec = resolution.tool_specs[0]
    assert spec.needs_approval is False
    assert spec.effective_permission() == "allow"


async def test_trigger_builder_ops_have_expected_paths_and_defaults(connection):
    expected_paths = {
        "find_triggers": ("POST", "/api/triggers/discover"),
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
    gated = {
        "create_schedule",
        "create_subscription",
        "test_subscription",
        "remove_schedule",
        "remove_subscription",
        "pause_schedule",
        "resume_schedule",
        "pause_subscription",
        "resume_subscription",
    }

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op=op) for op in expected_paths]
    )
    specs = {spec.name: spec for spec in resolution.tool_specs}

    for name, (method, path) in expected_paths.items():
        assert specs[name].call.method == method
        assert specs[name].call.path == path
        if name in gated:
            assert specs[name].needs_approval is True
            assert specs[name].effective_permission() == "ask"
        else:
            assert specs[name].needs_approval is False
            assert specs[name].effective_permission() == "allow"


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
    assert "references" not in schedule.input_schema["properties"]["data"]["properties"]
    assert "selector" not in schedule.input_schema["properties"]["data"]["properties"]

    subscription = specs["create_subscription"]
    assert subscription.call.args_into == "subscription"
    assert subscription.call.context == {
        "subscription.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
    }
    data_props = subscription.input_schema["properties"]["data"]["properties"]
    assert "references" not in data_props
    assert "selector" not in data_props


async def test_config_permission_overrides_the_catalog_default(connection):
    # An author override beats the catalog default (here: force-allow a normally-gated op).
    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(
                op="commit_revision", needs_approval=False, permission="allow"
            )
        ]
    )
    spec = resolution.tool_specs[0]
    assert spec.needs_approval is False
    assert spec.effective_permission() == "allow"


# --- resolver: error paths ----------------------------------------------------


async def test_unknown_op_in_config_raises(connection):
    with pytest.raises(UnknownPlatformOpError):
        await _resolver(connection).resolve([PlatformToolConfig(op="nope")])


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve([PlatformToolConfig(op="find_capabilities")])


async def test_duplicate_platform_tool_rejected(connection):
    with pytest.raises(GatewayToolResolutionError, match="Duplicate platform tool"):
        await _resolver(connection).resolve(
            [
                PlatformToolConfig(op="find_capabilities"),
                PlatformToolConfig(op="find_capabilities"),
            ]
        )
