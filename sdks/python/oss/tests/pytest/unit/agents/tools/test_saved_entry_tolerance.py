"""Tolerance for saved tool entries the strict parser used to refuse.

A revision's tool entries are never validated against these models when they are written:
the agent's own ``commit_revision`` writes free JSON, and the commit gate validates only the
revision DTO, whose ``parameters`` is an open dict. Two shapes reached production and failed
every invoke with a 500 at config-parse time:

* a ``gateway_connection`` entry with no ``policy`` node,
* a pre-2026-08-27 ``gateway`` entry that spells the action ``provider_action``.

An unrunnable entry must cost its own tool, never the whole run.
"""

from __future__ import annotations

from typing import Any, List, Tuple

import pytest

from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform.gateway import _to_gateway_reference
from agenta.sdk.agents.tools import (
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    ToolConfigurationError,
    coerce_tool_config,
    coerce_tool_configs,
    parse_tool_config,
)
from agenta.sdk.agents.tools.gateway_policy import (
    CatalogToolInfo,
    compile_gateway_permissions,
)

# Shape A, exactly as production saved it: the three routing fields, no policy.
_NO_POLICY_ENTRY = {
    "type": "gateway_connection",
    "connection": {
        "provider": "composio",
        "integration": "github",
        "slug": "github-work",
    },
}

# Shape B: the legacy action field name, which no migration ever rewrote.
_PROVIDER_ACTION_ENTRY = {
    "type": "gateway",
    "provider": "composio",
    "integration": "github",
    "provider_action": "GITHUB_GET_AN_ISSUE",
    "connection": "github-work",
}

_CLIENT_ENTRY = {
    "type": "client",
    "name": "ask_user",
    "description": "Ask the caller.",
    "input_schema": {"type": "object"},
}


# --- Shape A: a connection entry with no policy -------------------------------------


def test_a_connection_entry_without_a_policy_parses():
    config = parse_tool_config(_NO_POLICY_ENTRY)
    assert isinstance(config, GatewayConnectionToolConfig)
    assert config.connection.slug == "github-work"


def test_an_absent_policy_means_inherit():
    # Absent is not "allow" and not "deny": every tool defers to the agent-wide mode, which
    # is what the runner would have applied had the entry never been configured at all.
    config = parse_tool_config(_NO_POLICY_ENTRY)
    assert config.policy.permissions.default == "inherit"
    assert config.policy.permissions.tools == {}


def test_an_absent_policy_compiles_to_the_agent_wide_mode():
    config = parse_tool_config(_NO_POLICY_ENTRY)
    compiled = compile_gateway_permissions(
        config.policy.permissions,
        [
            CatalogToolInfo(key="GITHUB_GET_AN_ISSUE", read_only=True),
            CatalogToolInfo(key="GITHUB_CREATE_AN_ISSUE", read_only=False),
        ],
        "allow_reads",
    )
    assert compiled.tools["GITHUB_GET_AN_ISSUE"].permission == "allow"
    assert compiled.tools["GITHUB_CREATE_AN_ISSUE"].permission == "ask"
    assert compiled.stale_keys == []


def test_an_explicit_policy_still_wins():
    # The default must not overwrite an authored policy, in either direction.
    config = parse_tool_config(
        {
            **_NO_POLICY_ENTRY,
            "policy": {
                "permissions": {
                    "default": "deny",
                    "tools": {"GITHUB_GET_AN_ISSUE": "allow"},
                }
            },
        }
    )
    assert config.policy.permissions.default == "deny"
    assert config.policy.permissions.tools == {"GITHUB_GET_AN_ISSUE": "allow"}


# --- Shape B: the legacy provider_action spelling -----------------------------------


def test_provider_action_is_read_as_the_action():
    # The translation lives in the compat layer, which is what every reader of a SAVED
    # revision goes through. `parse_tool_config` stays strict on the canonical spelling.
    config = coerce_tool_config(_PROVIDER_ACTION_ENTRY)
    assert isinstance(config, GatewayToolConfig)
    assert config.connection == "github-work"


def test_the_integration_prefix_is_stripped_from_a_provider_action():
    # The backend resolves a legacy reference by the CATALOG KEY, which carries no
    # integration prefix. A verbatim copy of the provider action id would name a tool the
    # catalog does not hold, and the run would drop the tool as stale.
    config = coerce_tool_config(_PROVIDER_ACTION_ENTRY)
    assert config.action == "GET_AN_ISSUE"


def test_a_provider_action_without_the_prefix_is_kept_whole():
    config = coerce_tool_config(
        {**_PROVIDER_ACTION_ENTRY, "provider_action": "GET_AN_ISSUE"}
    )
    assert config.action == "GET_AN_ISSUE"


def test_an_integration_whose_case_differs_still_strips_the_prefix():
    # The catalog builds the prefix from the UPPER-CASED integration, so the integration's
    # own case never decides the key.
    config = coerce_tool_config({**_PROVIDER_ACTION_ENTRY, "integration": "GitHub"})
    assert config.action == "GET_AN_ISSUE"


def test_a_lower_case_prefix_on_the_provider_id_is_not_stripped():
    # The catalog matches the RAW provider id against that upper-cased prefix, so a
    # lower-case prefix is not a prefix and stays part of the key. Stripping it here would
    # turn a key the catalog holds into one it does not.
    config = coerce_tool_config(
        {**_PROVIDER_ACTION_ENTRY, "provider_action": "github_GET_AN_ISSUE"}
    )
    assert config.action == "github_GET_AN_ISSUE"


def test_an_integration_with_an_underscore_strips_its_whole_prefix():
    config = coerce_tool_config(
        {
            **_PROVIDER_ACTION_ENTRY,
            "integration": "google_drive",
            "provider_action": "GOOGLE_DRIVE_LIST_FILES",
        }
    )
    assert config.action == "LIST_FILES"


def test_a_translated_entry_carries_the_catalog_key_in_its_gateway_reference():
    # The reference the resolver sends to the backend is where the key has to be right: the
    # backend matches it against the catalog key, so a provider id here resolves to nothing
    # and the tool is dropped as stale at run time instead of running. This pins the
    # serialized reference, not the HTTP resolution behind it.
    reference = _to_gateway_reference(coerce_tool_config(_PROVIDER_ACTION_ENTRY))
    assert reference == {
        "type": "gateway",
        "provider": "composio",
        "integration": "github",
        "action": "GET_AN_ISSUE",
        "connection": "github-work",
    }


def test_an_explicit_action_wins_over_provider_action():
    config = coerce_tool_config(
        {**_PROVIDER_ACTION_ENTRY, "action": "GITHUB_CREATE_AN_ISSUE"}
    )
    assert config.action == "GITHUB_CREATE_AN_ISSUE"


# --- An entry that cannot be repaired -----------------------------------------------


def test_an_unrepairable_gateway_entry_is_collected_not_raised():
    # No action under either spelling and no connection: there is nothing to run. It is
    # reported per entry so the caller can drop it.
    result = coerce_tool_configs(
        [{"type": "gateway", "provider": "composio", "integration": "github"}],
        on_error="collect",
    )
    assert result.tool_configs == []
    assert [d.index for d in result.diagnostics] == [0]


class _RecordingLog:
    def __init__(self) -> None:
        self.warnings: List[Tuple[str, Any]] = []

    def warning(self, message: str, *args: Any) -> None:
        self.warnings.append((message, args))


def test_an_unrepairable_entry_is_dropped_with_a_warning_and_the_rest_survive(
    monkeypatch: pytest.MonkeyPatch,
):
    # The whole point of the fix: one dead entry costs its own tool, not the agent's run.
    recorder = _RecordingLog()
    monkeypatch.setattr("agenta.sdk.agents.dtos.log", recorder)

    template = AgentTemplate(
        tools=[
            {"type": "gateway", "provider": "composio", "integration": "github"},
            _NO_POLICY_ENTRY,
            _PROVIDER_ACTION_ENTRY,
            _CLIENT_ENTRY,
        ]
    )

    kinds = [type(tool).__name__ for tool in template.tools]
    assert kinds == [
        "GatewayConnectionToolConfig",
        "GatewayToolConfig",
        "ClientToolConfig",
    ]
    assert len(recorder.warnings) == 1


def test_a_misspelled_tool_field_still_fails_the_run():
    # Tolerance must not swallow a typo. The author believes this tool is configured, so a
    # silent drop would take it away with nothing to see anywhere.
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(tools=[{"type": "client", "nmae": "ask_user"}])


def test_two_conflicting_policies_for_one_integration_still_fail_the_run():
    # One integration takes one entry. Dropping the second would silently pick a policy,
    # and the pair here disagree: the run would allow what the author also denied.
    permissive = {
        **_NO_POLICY_ENTRY,
        "policy": {"permissions": {"default": "allow", "tools": {}}},
    }
    restrictive = {
        **_NO_POLICY_ENTRY,
        "policy": {"permissions": {"default": "deny", "tools": {}}},
    }
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(tools=[permissive, restrictive])


def test_a_malformed_connection_entry_still_fails_the_run():
    # Only the LEGACY gateway shape is tolerated. A connection entry missing a routing
    # field is a current-format mistake, and it stays a loud one.
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(
            tools=[
                {
                    "type": "gateway_connection",
                    "connection": {"provider": "composio", "integration": "github"},
                }
            ]
        )


def test_a_malformed_current_format_gateway_entry_still_fails_the_run():
    # A `gateway` entry carrying no legacy mark is authored today, not inherited. This one
    # names an action and no connection, so it is a mistake its author must see rather than
    # a shape from before the rework.
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(
            tools=[
                {
                    "type": "gateway",
                    "provider": "composio",
                    "integration": "github",
                    "action": "GET_AN_ISSUE",
                }
            ]
        )


def test_an_empty_action_beside_a_legacy_one_is_repaired():
    # An empty `action` is not an authored value, so the legacy field fills it. A NON-empty
    # one is authored and is never overwritten, which
    # `test_an_explicit_action_wins_over_provider_action` pins.
    config = coerce_tool_config({**_PROVIDER_ACTION_ENTRY, "action": ""})
    assert config.action == "GET_AN_ISSUE"


def test_a_null_entry_still_fails_the_run():
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(tools=[None])


def test_a_non_dict_entry_that_is_not_a_name_still_fails_the_run():
    with pytest.raises(ToolConfigurationError):
        AgentTemplate(tools=[["gateway"]])


def test_the_composio_alias_is_tolerated_like_the_gateway_tag(
    monkeypatch: pytest.MonkeyPatch,
):
    # `composio` is the same legacy shape under its older tag, renamed before it parses.
    recorder = _RecordingLog()
    monkeypatch.setattr("agenta.sdk.agents.dtos.log", recorder)

    template = AgentTemplate(
        tools=[{"type": "composio", "integration": "github"}, _CLIENT_ENTRY]
    )

    assert [type(tool).__name__ for tool in template.tools] == ["ClientToolConfig"]
    assert len(recorder.warnings) == 1


def test_a_template_with_only_valid_tools_logs_nothing(
    monkeypatch: pytest.MonkeyPatch,
):
    recorder = _RecordingLog()
    monkeypatch.setattr("agenta.sdk.agents.dtos.log", recorder)

    template = AgentTemplate(tools=[_NO_POLICY_ENTRY, _CLIENT_ENTRY])

    assert len(template.tools) == 2
    assert recorder.warnings == []
