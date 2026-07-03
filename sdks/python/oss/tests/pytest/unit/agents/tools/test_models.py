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
from agenta.sdk.agents.tools.models import coerce_tool_spec, effective_permission


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


def test_platform_tool_discriminator():
    config = PlatformToolConfig(op="find_capabilities")
    assert config.type == "platform"
    assert config.op == "find_capabilities"


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
        "render": {"kind": "component", "component": "Calculator"},
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


# --- Layer-3 permission and runner-mode helper ---------------------------------------


def _spec(**kwargs):
    return CallbackToolSpec(
        name="t",
        description="t",
        call_ref="tools.composio.x.Y.c1",
        **kwargs,
    )


def test_tool_spec_effective_permission_is_explicit_only():
    spec = _spec(read_only=True, permission="allow")
    assert spec.effective_permission() == "allow"
    assert spec.to_wire()["permission"] == "allow"

    inherited = _spec(read_only=True)
    assert inherited.effective_permission() is None
    assert "permission" not in inherited.to_wire()
    assert inherited.to_wire()["readOnly"] is True


@pytest.mark.parametrize(
    ("spec_permission", "read_only", "mode", "expected"),
    [
        ("deny", True, "allow", "deny"),
        (None, True, "allow_reads", "allow"),
        (None, False, "allow_reads", "ask"),
        (None, None, "allow_reads", "ask"),
        (None, True, "allow", "allow"),
        (None, False, "allow", "allow"),
        (None, None, "ask", "ask"),
        (None, True, "deny", "deny"),
    ],
)
def test_effective_permission_helper_truth_table(
    spec_permission, read_only, mode, expected
):
    assert effective_permission(spec_permission, read_only, mode) == expected


def test_legacy_permission_fields_are_ignored_on_specs():
    spec = CallbackToolSpec.model_validate(
        {
            "name": "t",
            "description": "t",
            "callRef": "tools.composio.x.Y.c1",
            "permission_mode": "deny",
            "needsApproval": True,
        }
    )
    assert spec.permission is None
    assert "permission" not in spec.to_wire()
    assert "needsApproval" not in spec.to_wire()


def test_builtin_tool_permission_is_dropped_not_enforced():
    # Builtins are granted by selection; a per-builtin permission has no enforcement
    # point on Pi, so the config drops it (with a warning) instead of lying.
    from agenta.sdk.agents.tools.models import BuiltinToolConfig

    config = BuiltinToolConfig.model_validate(
        {"type": "builtin", "name": "bash", "permission": "deny"}
    )
    assert config.permission is None
