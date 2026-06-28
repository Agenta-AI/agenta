"""The platform-op catalog and its resolver (direct-call tools, Phase 3b).

A ``type:"platform"`` tool exposes an EXISTING Agenta endpoint to the agent. The catalog
(``op_catalog.py``) owns the description, the endpoint, the input schema, the run-context bind, and
the per-op default permission/approval; the resolver (``AgentaPlatformToolResolver``) turns each
config into a ``CallbackToolSpec`` carrying a direct ``call`` descriptor (no ``/tools/call`` hop).

These tests cover: the catalog model's import-time validation, the resolver emitting a direct
``call`` (find_capabilities), the self-update ``bind`` stripping its bound field from the
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


def test_catalog_ships_the_three_first_ops():
    assert set(PLATFORM_OPS) == {
        "find_capabilities",
        "query_workflows",
        "commit_revision",
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


def test_op_bind_token_must_be_a_ctx_reference():
    with pytest.raises(ValidationError, match=r"\$ctx"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            bind={"field": "workflow.variant.id"},  # missing $ctx. prefix
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
    # The bind rides as call.context — the runner fills it from runContext at dispatch.
    assert spec.call.context == {
        "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    # The bound field is gone from the model-visible schema (and its `required`); the payload fields
    # the model SHOULD supply remain.
    workflow_revision = spec.input_schema["properties"]["workflow_revision"]
    assert "workflow_variant_id" not in workflow_revision["properties"]
    assert set(workflow_revision["properties"]) == {"message", "data"}
    assert "required" not in workflow_revision  # only the bound field was required


async def test_commit_revision_defaults_to_approval(connection):
    # A mutating op defaults to needs_approval=True -> effective `ask` (self-update is gated).
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    assert spec.needs_approval is True
    assert spec.effective_permission() == "ask"


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
