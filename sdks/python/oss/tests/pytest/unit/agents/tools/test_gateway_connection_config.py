"""The saved gateway connection entry (qa.md C20 to C24, C28 to C30, C34).

Parse and validation cases for the ``gateway_connection`` arm, plus the dual-read rule:
a legacy ``gateway`` entry must keep parsing while saved revisions migrate.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.tools import (
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    ToolConfigurationError,
    coerce_tool_config,
    coerce_tool_configs,
    parse_tool_config,
)

_ENTRY = {
    "type": "gateway_connection",
    "connection": {
        "provider": "composio",
        "integration": "github",
        "slug": "github-work",
    },
    "policy": {
        "permissions": {
            "default": "deny",
            "tools": {
                "GET_ISSUE": "inherit",
                "CREATE_ISSUE": "ask",
                "DELETE_REPOSITORY": "deny",
            },
        }
    },
}

_LEGACY_ENTRY = {
    "type": "gateway",
    "provider": "composio",
    "integration": "github",
    "action": "GET_ISSUE",
    "connection": "github-work",
    "permission": "allow",
}


def _entry(**overrides):
    return {**_ENTRY, **overrides}


# --- C28, C29, C30: parsing --------------------------------------------------------


def test_connection_entry_parses_into_the_new_model():
    # C28.
    config = parse_tool_config(_ENTRY)
    assert isinstance(config, GatewayConnectionToolConfig)
    assert config.connection.provider == "composio"
    assert config.connection.integration == "github"
    assert config.connection.slug == "github-work"
    assert config.policy.permissions.default == "deny"
    assert config.policy.permissions.tools == {
        "GET_ISSUE": "inherit",
        "CREATE_ISSUE": "ask",
        "DELETE_REPOSITORY": "deny",
    }


def test_legacy_gateway_entry_still_parses():
    # C29. The dual-read window is open, so an old revision must keep working.
    config = parse_tool_config(_LEGACY_ENTRY)
    assert isinstance(config, GatewayToolConfig)
    assert config.reference == "tools.composio.github.GET_ISSUE.github-work"
    assert config.permission == "allow"


def test_a_revision_holding_both_entry_types_parses():
    # C30. A half-migrated agent is a supported state, not only a transient one.
    result = coerce_tool_configs([_LEGACY_ENTRY, _ENTRY])
    assert [type(config) for config in result.tool_configs] == [
        GatewayToolConfig,
        GatewayConnectionToolConfig,
    ]


def test_the_compat_parser_accepts_a_connection_entry():
    assert isinstance(coerce_tool_config(_ENTRY), GatewayConnectionToolConfig)


def test_tools_defaults_to_an_empty_map():
    config = parse_tool_config(
        _entry(policy={"permissions": {"default": "inherit"}}),
    )
    assert config.policy.permissions.tools == {}


# --- C20 to C23: validation --------------------------------------------------------


def test_a_missing_default_is_rejected():
    # C20. Without a default there is no answer for a catalog tool the entry never names.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(policy={"permissions": {"tools": {}}}))


def test_a_missing_policy_is_rejected():
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(
            {key: value for key, value in _ENTRY.items() if key != "policy"}
        )


@pytest.mark.parametrize(
    "policy",
    [
        {"permissions": {"default": "maybe"}},
        {"permissions": {"default": "inherit", "tools": {"GET_ISSUE": "maybe"}}},
        {"permissions": {"default": None}},
    ],
)
def test_an_unknown_permission_value_is_rejected(policy):
    # C21. Only inherit, allow, ask, and deny exist.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(policy=policy))


@pytest.mark.parametrize(
    "entry",
    [
        {"unexpected": True},
        {"permissions": {"default": "deny"}},
        {"connection": {**_ENTRY["connection"], "account_id": "acc_1"}},
        {"policy": {"permissions": {"default": "deny"}, "include": ["GET_ISSUE"]}},
        {"policy": {"permissions": {"default": "deny", "read_only": True}}},
    ],
)
def test_an_unknown_field_is_rejected(entry):
    # C22. `extra="forbid"` at every level, so a typo never silently loses a rule and the
    # entry never grows a second policy surface.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(**entry))


@pytest.mark.parametrize(
    "entry",
    [
        {"permission": "deny"},
        {"render": {"kind": "component", "component": "Github"}},
        {"needs_approval": True},
        {"needsApproval": True},
        {"permission_mode": "deny"},
        {"permissionMode": "deny"},
    ],
)
def test_a_top_level_permission_or_render_is_rejected(entry):
    # A whole integration has no single tool for a per-tool permission, so the entry takes
    # neither of the two shared fields the other arms carry. Accepting one and ignoring it
    # would let an author believe a top-level `deny` applies. The four deleted legacy
    # spellings are refused here too, rather than dropped in silence.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(**entry))


@pytest.mark.parametrize("field", ["provider", "integration", "slug"])
def test_an_empty_routing_field_is_rejected(field):
    # C23.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(connection={**_ENTRY["connection"], field: ""}))


@pytest.mark.parametrize("provider", ["other", "Composio", "zapier"])
def test_a_provider_other_than_composio_is_rejected(provider):
    # Contracts section 1: only `composio` is supported. qa.md carries no ID for this case;
    # C23 is the empty-value rule above, not this one.
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(
            _entry(connection={**_ENTRY["connection"], "provider": provider})
        )


@pytest.mark.parametrize("field", ["integration", "slug"])
def test_a_missing_routing_field_is_rejected(field):
    connection = {
        key: value for key, value in _ENTRY["connection"].items() if key != field
    }
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(_entry(connection=connection))


def test_an_empty_tool_key_is_rejected():
    with pytest.raises(ToolConfigurationError):
        parse_tool_config(
            _entry(policy={"permissions": {"default": "deny", "tools": {"": "allow"}}}),
        )


# --- C24: the revision-level rule --------------------------------------------------


@pytest.mark.parametrize(
    "second",
    [
        # The same entry twice.
        {},
        # A second connection for the same integration. The slug is not part of the key,
        # so this is a duplicate too: there is no rule for which policy would win.
        {"connection": {**_ENTRY["connection"], "slug": "github-personal"}},
    ],
)
def test_two_entries_for_one_integration_are_rejected(second):
    # C24. A revision-level rule, so it is driven through `coerce_tool_configs` with a
    # list. The single-entry adapter never sees two entries and cannot enforce it.
    with pytest.raises(ToolConfigurationError) as caught:
        coerce_tool_configs([_ENTRY, _entry(**second)])
    assert caught.value.index == 1


def test_the_duplicate_rule_is_scoped_to_one_integration():
    # The rule bites per integration, so a second integration on the same provider is not
    # a duplicate. Only `composio` exists, so the provider half cannot vary today.
    result = coerce_tool_configs(
        [
            _ENTRY,
            _entry(connection={**_ENTRY["connection"], "integration": "slack"}),
        ]
    )
    assert len(result.tool_configs) == 2


def test_a_duplicate_entry_is_reported_in_collect_mode():
    result = coerce_tool_configs([_ENTRY, _entry()], on_error="collect")
    assert len(result.tool_configs) == 1
    assert [diagnostic.index for diagnostic in result.diagnostics] == [1]


# --- C34: catalog drift ------------------------------------------------------------


def test_a_saved_key_absent_from_the_catalog_keeps_the_revision_parsable():
    # C34. The saved model knows nothing about the current catalog, so drift cannot make
    # an old revision unparsable. The compiler reports the key as stale instead (C19).
    config = parse_tool_config(
        _entry(
            policy={
                "permissions": {"default": "deny", "tools": {"RETIRED_TOOL": "allow"}}
            }
        ),
    )
    assert config.policy.permissions.tools == {"RETIRED_TOOL": "allow"}
