from __future__ import annotations

import pytest

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    GatewayToolConfig,
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
