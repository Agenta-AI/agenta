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
from agenta.sdk.agents.tools import (
    GatewayConnectionToolConfig,
    GatewayToolConfig,
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
    assert config.action == "GITHUB_GET_AN_ISSUE"
    assert config.connection == "github-work"


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


def test_a_template_with_only_valid_tools_logs_nothing(
    monkeypatch: pytest.MonkeyPatch,
):
    recorder = _RecordingLog()
    monkeypatch.setattr("agenta.sdk.agents.dtos.log", recorder)

    template = AgentTemplate(tools=[_NO_POLICY_ENTRY, _CLIENT_ENTRY])

    assert len(template.tools) == 2
    assert recorder.warnings == []
