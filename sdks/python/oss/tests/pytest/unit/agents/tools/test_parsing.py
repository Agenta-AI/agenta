from __future__ import annotations

import pytest

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    ClientToolConfig,
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
    assert gateway.needs_approval is True
    assert gateway.render == {"kind": "component", "component": "User"}


def test_compat_parser_does_not_flip_string_false_needs_approval():
    # Legacy payloads may carry the flag as the string "false"; it must not coerce to True
    # (a plain ``bool("false")`` would).
    gateway = coerce_tool_config(
        {
            "function": {"name": "tools__composio__github__GET_USER__c1"},
            "needs_approval": "false",
        }
    )
    assert gateway.needs_approval is False

    approved = coerce_tool_config(
        {
            "function": {"name": "tools__composio__github__GET_USER__c1"},
            "needs_approval": "true",
        }
    )
    assert approved.needs_approval is True


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


def test_compat_parser_accepts_permission_mode_alias_for_permission():
    # The legacy FE key `permission_mode` deserializes to the same `permission` field.
    gateway = coerce_tool_config(
        {
            "type": "gateway",
            "integration": "github",
            "action": "GET_USER",
            "connection": "c1",
            "permission_mode": "deny",
        }
    )
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


def test_compat_parser_maps_openai_function_to_client_tool():
    # The FE writes custom tools in the OpenAI function shape. Coerce them to a
    # client tool, reading the name from ``function.name`` (not top-level) — a
    # non-gateway function tool previously raised "Unsupported tool configuration
    # shape" (server dispatch 500) and resolved to an ``undefined`` name in the runner.
    client = coerce_tool_config(
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            },
        }
    )
    assert isinstance(client, ClientToolConfig)
    assert client.name == "get_weather"
    assert client.description == "Get current weather"
    assert client.input_schema["properties"]["location"]["type"] == "string"


def test_compat_parser_function_tool_carries_metadata():
    # Approval/permission siblings survive the function -> client coercion.
    client = coerce_tool_config(
        {
            "type": "function",
            "function": {"name": "get_weather"},
            "needs_approval": True,
            "permission": "deny",
        }
    )
    assert isinstance(client, ClientToolConfig)
    assert client.needs_approval is True
    assert client.permission == "deny"
    # No `parameters` => keep ClientToolConfig's default object schema, NOT a bare {} that
    # would widen the contract to "any JSON".
    assert client.input_schema == {"type": "object", "properties": {}}


def test_compat_parser_rejects_function_shape_without_type():
    # The function -> client coercion is gated on the explicit `type: "function"` shape. A
    # `function.name` that is not a gateway slug and carries no `type` is an unknown shape and
    # must fail loud rather than silently becoming a client tool.
    with pytest.raises(ToolConfigurationError):
        coerce_tool_config({"function": {"name": "not_a_slug"}})


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
            "needs_approval": True,
            "render": {"kind": "component", "component": "Card"},
            "permission": "ask",
        }
    )
    assert isinstance(tool, ReferenceToolConfig)
    assert tool.needs_approval is True
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
    # needs_approval is optional (None = use the catalog default).
    assert tool.needs_approval is None


def test_compat_parser_accepts_platform_type():
    tool = coerce_tool_config(
        {"type": "platform", "op": "commit_revision", "needs_approval": False}
    )
    assert isinstance(tool, PlatformToolConfig)
    assert tool.op == "commit_revision"
    assert tool.needs_approval is False


def test_typed_platform_without_op_raises():
    with pytest.raises(ToolConfigurationError):
        coerce_tool_config({"type": "platform"})
