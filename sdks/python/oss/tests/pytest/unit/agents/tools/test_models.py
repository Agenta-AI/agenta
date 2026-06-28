from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    CodeToolConfig,
    CodeToolSpec,
    PlatformToolConfig,
    ReferenceToolConfig,
)
from agenta.sdk.agents.tools.models import coerce_tool_spec


def test_reference_tool_variant_call_ref_grammar():
    # variant axis -> workflow.variant.{slug}; pinned -> workflow.variant.{slug}.{version}.
    # Distinct from the Composio 5-segment grammar so the server routes by the `workflow.` prefix.
    assert ReferenceToolConfig(slug="wf").call_ref == "workflow.variant.wf"
    assert (
        ReferenceToolConfig(slug="wf", version="2").call_ref == "workflow.variant.wf.2"
    )
    # ref_by defaults to "variant".
    assert ReferenceToolConfig(slug="wf").ref_by == "variant"
    # The model-visible name defaults to the slug when none is authored.
    assert ReferenceToolConfig(slug="wf").tool_name == "wf"
    assert ReferenceToolConfig(slug="wf", name="run").tool_name == "run"


def test_reference_tool_environment_call_ref_grammar():
    # environment axis -> workflow.environment.{environment}.{slug}; the environment is the pin.
    config = ReferenceToolConfig(
        ref_by="environment", environment="production", slug="wf"
    )
    assert config.call_ref == "workflow.environment.production.wf"


def test_reference_tool_environment_requires_environment_slug():
    with pytest.raises(ValidationError):
        ReferenceToolConfig(ref_by="environment", slug="wf")


def test_reference_tool_environment_forbids_version():
    with pytest.raises(ValidationError):
        ReferenceToolConfig(
            ref_by="environment", environment="production", slug="wf", version="2"
        )


def test_reference_tool_variant_forbids_environment_slug():
    with pytest.raises(ValidationError):
        ReferenceToolConfig(ref_by="variant", environment="production", slug="wf")


def test_reference_tool_discriminator_is_reference():
    config = ReferenceToolConfig(slug="wf")
    assert config.type == "reference"


def test_platform_tool_discriminator_and_optional_approval():
    # type:"platform" is its own arm of the ToolConfig union. needs_approval is optional (None =
    # use the catalog's per-op default), unlike the base where it defaults to False.
    config = PlatformToolConfig(op="find_capabilities")
    assert config.type == "platform"
    assert config.op == "find_capabilities"
    assert config.needs_approval is None
    # An explicit override is preserved.
    assert PlatformToolConfig(op="x", needs_approval=True).needs_approval is True


def test_platform_tool_requires_op():
    with pytest.raises(ValidationError):
        PlatformToolConfig()  # type: ignore[call-arg]


def test_canonical_config_forbids_unexpected_fields():
    with pytest.raises(ValidationError):
        CodeToolConfig(
            name="calc",
            script="def main(): return 1",
            unexpected=True,
        )


def test_code_spec_serializes_only_runner_fields():
    spec = CodeToolSpec(
        name="calc",
        description="Calculate",
        input_schema={"type": "object", "properties": {}},
        runtime="python",
        code="def main(): return 1",
        env={"TOKEN": "secret"},
        needs_approval=True,
        render={"kind": "component", "component": "Calculator"},
    )
    assert spec.to_wire() == {
        "name": "calc",
        "description": "Calculate",
        "inputSchema": {"type": "object", "properties": {}},
        "kind": "code",
        "runtime": "python",
        "code": "def main(): return 1",
        "env": {"TOKEN": "secret"},
        "needsApproval": True,
        "render": {"kind": "component", "component": "Calculator"},
        # needs_approval with no explicit permission -> derived `ask`.
        "permission": "ask",
    }


def test_callback_spec_has_stable_typed_contract():
    spec = CallbackToolSpec(
        name="get_user",
        description="Get user",
        call_ref="tools.composio.github.GET_USER.c1",
    )
    assert spec.to_wire()["kind"] == "callback"
    assert spec.to_wire()["callRef"] == "tools.composio.github.GET_USER.c1"
    # A gateway spec carries no `call` descriptor.
    assert "call" not in spec.to_wire()


def test_callback_spec_direct_call_round_trips_on_the_wire():
    # A direct-call callback spec carries a `call` descriptor instead of `call_ref` (the
    # `call` XOR `call_ref` rule). The descriptor round-trips through the wire keeping its
    # method/path/body and the snake_case `args_into`; the unset `context` is omitted.
    spec = CallbackToolSpec(
        name="get_weather",
        description="Look up weather for a city",
        input_schema={"type": "object", "properties": {"city": {"type": "string"}}},
        call={
            "method": "POST",
            "path": "/api/workflows/invoke",
            "body": {"references": {"workflow_revision": {"id": "rev_abc123"}}},
            "args_into": "data.inputs",
        },
    )
    wire = spec.to_wire()
    assert wire["kind"] == "callback"
    assert "callRef" not in wire
    assert wire["call"] == {
        "method": "POST",
        "path": "/api/workflows/invoke",
        "body": {"references": {"workflow_revision": {"id": "rev_abc123"}}},
        "args_into": "data.inputs",
    }
    # The wire dict round-trips back into an equal spec via the coercion path.
    assert coerce_tool_spec(wire) == spec


def test_callback_spec_requires_exactly_one_call_target():
    # Neither `call_ref` nor `call` -> invalid (a callback tool must have a target).
    with pytest.raises(ValidationError):
        CallbackToolSpec(name="t", description="t")
    # Both `call_ref` and `call` -> invalid (the XOR rule).
    with pytest.raises(ValidationError):
        CallbackToolSpec(
            name="t",
            description="t",
            call_ref="tools.composio.x.Y.c1",
            call={"method": "GET", "path": "/api/ping"},
        )


def test_secret_values_are_hidden_from_repr():
    spec = CodeToolSpec(
        name="private",
        description="private",
        code="...",
        env={"TOKEN": "do-not-print"},
    )
    assert "do-not-print" not in repr(spec)


# --- Layer-3 permission default ladder (S3a) -----------------------------------------


def _spec(**kwargs):
    return CallbackToolSpec(
        name="t",
        description="t",
        call_ref="tools.composio.x.Y.c1",
        **kwargs,
    )


def test_permission_explicit_author_value_wins():
    # An explicit author permission wins over any read_only/needs_approval default.
    spec = _spec(read_only=False, permission="allow")
    assert spec.effective_permission() == "allow"
    assert spec.to_wire()["permission"] == "allow"


def test_permission_default_from_read_only_true_is_allow():
    spec = _spec(read_only=True)
    assert spec.effective_permission() == "allow"
    assert spec.to_wire()["permission"] == "allow"


def test_permission_default_from_read_only_false_is_ask():
    spec = _spec(read_only=False)
    assert spec.effective_permission() == "ask"
    assert spec.to_wire()["permission"] == "ask"


def test_permission_needs_approval_beats_read_only_auto_allow():
    # needs_approval (no explicit permission) forces `ask` even when read_only would allow.
    spec = _spec(read_only=True, needs_approval=True)
    assert spec.effective_permission() == "ask"
    assert spec.to_wire()["permission"] == "ask"


def test_permission_absent_when_all_unset():
    # read_only is None and nothing explicit -> no permission on the wire (runner falls back).
    spec = _spec()
    assert spec.effective_permission() is None
    assert "permission" not in spec.to_wire()


def test_permission_accepts_fe_permission_mode_alias():
    # The playground writes `permission_mode` into agenta_metadata; the spec deserializes it.
    spec = CallbackToolSpec.model_validate(
        {
            "name": "t",
            "description": "t",
            "callRef": "tools.composio.x.Y.c1",
            "permission_mode": "deny",
        }
    )
    assert spec.permission == "deny"
    assert spec.to_wire()["permission"] == "deny"
