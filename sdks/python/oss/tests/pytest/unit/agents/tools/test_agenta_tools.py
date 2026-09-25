"""The ``agenta_tools`` entry: its shape, and how the resolver expands it into platform tools."""

from __future__ import annotations

import logging
from typing import Sequence

import pytest

from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.platform import AgentaPlatformToolResolver, PlatformConnection
from agenta.sdk.agents.tools import (
    AGENTA_TOOLS,
    DEFAULT_AGENTA_TOOLS,
    AgentaToolsConfig,
    CallbackToolSpec,
    GatewayToolResolution,
    PlatformApiUnavailableError,
    PlatformToolConfig,
    ResolvedToolSet,
    ToolCallback,
    ToolConfigurationError,
    ToolResolver,
    coerce_tool_configs,
    parse_tool_config,
)
from agenta.sdk.models.workflows import WorkflowServiceRequest

from ..test_agent_composition_seam import _FakeBackend, _no_connection


class _Platform:
    """Builds one spec per platform config and records the permission each one carries."""

    def __init__(self) -> None:
        self.calls: list[list[PlatformToolConfig]] = []

    async def resolve(
        self, tools: Sequence[PlatformToolConfig], *, permission_default="allow_reads"
    ) -> GatewayToolResolution:
        self.calls.append(list(tools))
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.op,
                    description=tool.op,
                    call={"method": "POST", "path": f"/api/{tool.op}"},
                    permission=tool.permission,
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
        )


class _NoApi(_Platform):
    async def resolve(self, tools, *, permission_default="allow_reads"):
        raise PlatformApiUnavailableError("no API")


def _entry(**tools: str) -> dict:
    return {"type": "agenta_tools", "tools": tools}


async def _resolve(entries: list, *, platform=None, session_id="s-1"):
    return await ToolResolver(platform_resolver=platform or _Platform()).resolve(
        coerce_tool_configs(entries).tool_configs, session_id=session_id
    )


def _permissions(resolved) -> dict:
    return {spec.name: spec.permission for spec in resolved.tool_specs}


# --------------------------------------------------------------------------- #
# The entry
# --------------------------------------------------------------------------- #
def test_the_default_entry_turns_on_the_two_session_tools():
    assert DEFAULT_AGENTA_TOOLS == {
        "get_current_session": "allow",
        "rename_session": "allow",
    }
    assert set(DEFAULT_AGENTA_TOOLS) < set(AGENTA_TOOLS)
    assert "search_skills" not in AGENTA_TOOLS


@pytest.mark.parametrize("value", ["allow", "ask"])
def test_the_entry_parses_allow_and_ask(value):
    entry = parse_tool_config(_entry(create_schedule=value))
    assert isinstance(entry, AgentaToolsConfig)
    assert entry.tools == {"create_schedule": value}


def test_an_empty_map_parses():
    assert parse_tool_config(_entry()).tools == {}


@pytest.mark.parametrize("value", ["deny", "off", "inherit"])
def test_other_values_are_refused_and_the_error_names_the_allowed_ones(value):
    with pytest.raises(ToolConfigurationError) as caught:
        parse_tool_config(_entry(create_schedule=value))
    assert "'allow'" in str(caught.value) and "'ask'" in str(caught.value)


def test_a_top_level_permission_is_refused():
    with pytest.raises(ToolConfigurationError):
        parse_tool_config({**_entry(), "permission": "allow"})


# --------------------------------------------------------------------------- #
# Expansion
# --------------------------------------------------------------------------- #
async def test_the_entry_expands_into_one_platform_tool_per_listed_tool():
    resolved = await _resolve(
        [_entry(get_current_session="allow", list_schedules="ask")]
    )
    assert _permissions(resolved) == {
        "get_current_session": "allow",
        "list_schedules": "ask",
    }


async def test_the_listed_value_reaches_the_real_platform_spec():
    platform = AgentaPlatformToolResolver(PlatformConnection(base_url="http://api"))
    resolved = await _resolve([_entry(create_schedule="ask")], platform=platform)
    [spec] = resolved.tool_specs
    assert (spec.name, spec.permission, spec.read_only) == (
        "create_schedule",
        "ask",
        False,
    )


async def test_an_empty_map_adds_no_tool():
    assert (await _resolve([_entry()])).tool_specs == []


async def test_no_entry_means_no_agenta_tools():
    platform = _Platform()
    assert (await _resolve([], platform=platform)).tool_specs == []
    assert platform.calls == []


async def test_an_unknown_name_is_ignored_with_a_warning(caplog):
    with caplog.at_level(logging.WARNING):
        resolved = await _resolve([_entry(search_skills="allow", rename_session="ask")])
    assert _permissions(resolved) == {"rename_session": "ask"}
    assert "search_skills" in caplog.text


async def test_the_session_tools_are_skipped_without_a_session_id():
    resolved = await _resolve(
        [
            _entry(
                get_current_session="allow",
                rename_session="allow",
                list_schedules="allow",
            )
        ],
        session_id=None,
    )
    assert _permissions(resolved) == {"list_schedules": "allow"}


async def test_the_entry_is_skipped_with_a_warning_without_an_api_address(caplog):
    with caplog.at_level(logging.WARNING):
        resolved = await _resolve([_entry(**DEFAULT_AGENTA_TOOLS)], platform=_NoApi())
    assert resolved.tool_specs == []
    assert resolved.warnings and "Agenta tools" in resolved.warnings[0]


async def test_the_real_platform_resolver_reports_a_missing_api_address(monkeypatch):
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    monkeypatch.setattr(
        "agenta.sdk.agents.platform.connection._derive_base_url", lambda: None
    )
    resolved = await _resolve(
        [_entry(**DEFAULT_AGENTA_TOOLS)], platform=AgentaPlatformToolResolver()
    )
    assert resolved.tool_specs == []


# --------------------------------------------------------------------------- #
# Precedence: an explicit platform entry wins, and a tool appears once
# --------------------------------------------------------------------------- #
async def test_the_authors_platform_entry_wins():
    resolved = await _resolve(
        [
            {"type": "platform", "op": "create_schedule", "permission": "deny"},
            _entry(create_schedule="allow"),
        ]
    )
    assert _permissions(resolved) == {"create_schedule": "deny"}


async def test_a_build_kit_entry_wins_in_the_playground():
    # The build kit adds plain platform entries to the playground run copy.
    resolved = await _resolve(
        [
            _entry(commit_revision="ask"),
            {"type": "platform", "op": "commit_revision", "permission": "allow"},
        ]
    )
    assert _permissions(resolved) == {"commit_revision": "allow"}


async def test_a_tool_the_build_kit_deactivates_falls_back_to_the_entry():
    # A deactivated build kit tool is simply absent from the run copy.
    resolved = await _resolve(
        [
            {"type": "platform", "op": "read_config", "permission": "allow"},
            _entry(create_schedule="ask"),
        ]
    )
    assert _permissions(resolved) == {"read_config": "allow", "create_schedule": "ask"}


async def test_an_unlisted_tool_differs_from_an_authors_deny():
    resolved = await _resolve(
        [
            {"type": "platform", "op": "rename_agent", "permission": "deny"},
            _entry(),
        ]
    )
    assert _permissions(resolved) == {"rename_agent": "deny"}
    assert (await _resolve([_entry()])).tool_specs == []


async def test_the_handler_passes_the_runs_session_id_to_the_resolver():
    seen = []

    async def _resolve_tools(tools, **kwargs):
        seen.append(kwargs.get("session_id"))
        return ResolvedToolSet()

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: _FakeBackend(),
            resolve_connection=_no_connection,
            resolve_tools=_resolve_tools,
        )
    )
    await handler(
        request=WorkflowServiceRequest(session_id="s-42"),
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": {"kind": "pi_core"}}},
    )
    assert seen == ["s-42"]
