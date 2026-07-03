from __future__ import annotations

import pytest

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    GatewayToolConfig,
    PlatformToolConfig,
    ReferenceToolConfig,
    ToolConfigurationError,
    coerce_tool_config,
    coerce_tool_configs,
    parse_tool_config,
)


def test_strict_parser_accepts_only_canonical_mapping():
    tool = parse_tool_config({"type": "builtin", "name": "read"})
    assert isinstance(tool, BuiltinToolConfig)
    with pytest.raises(ToolConfigurationError):
        parse_tool_config({"name": "read"})


def test_compat_parser_accepts_legacy_shapes():
    assert coerce_tool_config("bash") == BuiltinToolConfig(name="bash")
    gateway = coerce_tool_config(
        {
            "type": "composio",
            "integration": "github",
            "action": "GET_USER",
            "connection": "c1",
        }
    )
    assert isinstance(gateway, GatewayToolConfig)
    assert gateway.provider == "composio"


def test_compat_parser_accepts_playground_gateway_slug_and_metadata():
    gateway = coerce_tool_config(
        {
            "function": {"name": "tools__composio__github__GET_USER__c1"},
            "needs_approval": True,
            "render": {"kind": "component", "component": "User"},
        }
    )
    assert gateway.render == {"kind": "component", "component": "User"}
    assert not hasattr(gateway, "needs_approval")


def test_compat_parser_ignores_legacy_permission_fields():
    gateway = coerce_tool_config(
        {
            "type": "gateway",
            "integration": "github",
            "action": "GET_USER",
            "connection": "c1",
            "needs_approval": "true",
            "permission_mode": "deny",
        }
    )
    assert gateway.permission is None
    assert not hasattr(gateway, "needs_approval")


def test_compat_parser_carries_top_level_permission_on_typed_config():
    # A canonical typed config dict carries the author's Layer-3 permission end to end.
    gateway = coerce_tool_config(
        {
            "type": "gateway",
            "integration": "github",
            "action": "GET_USER",
            "connection": "c1",
            "permission": "deny",
        }
    )
    assert isinstance(gateway, GatewayToolConfig)
    assert gateway.permission == "deny"


def test_compat_parser_carries_permission_from_gateway_slug():
    # The playground writes a gateway slug + a sibling permission; both survive coercion.
    gateway = coerce_tool_config(
        {
            "function": {"name": "tools.composio.github.GET_USER.c1"},
            "permission": "deny",
        }
    )
    assert isinstance(gateway, GatewayToolConfig)
    assert gateway.permission == "deny"


def test_compat_parser_omits_permission_when_absent():
    # Backward compatible: a tool with no permission leaves the field unset.
    gateway = coerce_tool_config(
        {
            "type": "gateway",
            "integration": "github",
            "action": "GET_USER",
            "connection": "c1",
        }
    )
    assert gateway.permission is None


def test_coerce_tool_configs_rejects_invalid_on_error():
    with pytest.raises(ValueError):
        coerce_tool_configs(["read"], on_error="bogus")  # type: ignore[arg-type]


def test_collect_mode_reports_invalid_entries():
    result = coerce_tool_configs(
        ["read", {"invalid": True}, None],
        on_error="collect",
    )
    assert result.tool_configs == [BuiltinToolConfig(name="read")]
    assert [diagnostic.index for diagnostic in result.diagnostics] == [1, 2]


def test_default_compat_mode_raises_with_index():
    with pytest.raises(ToolConfigurationError) as caught:
        coerce_tool_configs(["read", {"invalid": True}])
    assert caught.value.index == 1


# --- type:"reference" workflow tool ------------------------------------------


def test_typed_reference_config_round_trips():
    tool = parse_tool_config(
        {
            "type": "reference",
            "slug": "summarize",
            "name": "summarize",
            "description": "Summarize text",
            "input_schema": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
            },
        }
    )
    assert isinstance(tool, ReferenceToolConfig)
    assert tool.ref_by == "variant"
    assert tool.slug == "summarize"
    assert tool.version is None
    assert tool.call_ref == "workflow.variant.summarize"
    assert tool.tool_name == "summarize"
    assert tool.input_schema["properties"]["text"]["type"] == "string"


def test_typed_reference_version_builds_versioned_call_ref():
    tool = coerce_tool_config({"type": "reference", "slug": "wf", "version": "3"})
    assert isinstance(tool, ReferenceToolConfig)
    assert tool.call_ref == "workflow.variant.wf.3"
    # No authored name -> the model-visible name defaults to the workflow slug.
    assert tool.tool_name == "wf"


def test_typed_reference_environment_axis():
    tool = coerce_tool_config(
        {
            "type": "reference",
            "ref_by": "environment",
            "environment": "production",
            "slug": "wf",
        }
    )
    assert isinstance(tool, ReferenceToolConfig)
    assert tool.call_ref == "workflow.environment.production.wf"


def test_typed_reference_carries_tool_axes():
    tool = coerce_tool_config(
        {
            "type": "reference",
            "slug": "wf",
            "render": {"kind": "component", "component": "Card"},
            "permission": "ask",
        }
    )
    assert isinstance(tool, ReferenceToolConfig)
    assert tool.render == {"kind": "component", "component": "Card"}
    assert tool.permission == "ask"


def test_typed_reference_without_slug_raises():
    with pytest.raises(ToolConfigurationError):
        coerce_tool_config({"type": "reference"})


# --- type:"platform" tool ----------------------------------------------------


def test_typed_platform_config_round_trips():
    tool = parse_tool_config({"type": "platform", "op": "find_capabilities"})
    assert isinstance(tool, PlatformToolConfig)
    assert tool.op == "find_capabilities"


def test_compat_parser_accepts_platform_type_and_ignores_legacy_fields():
    tool = coerce_tool_config(
        {"type": "platform", "op": "commit_revision", "needs_approval": False}
    )
    assert isinstance(tool, PlatformToolConfig)
    assert tool.op == "commit_revision"
    assert not hasattr(tool, "needs_approval")


def test_typed_platform_without_op_raises():
    with pytest.raises(ToolConfigurationError):
        coerce_tool_config({"type": "platform"})
