"""The permission per target and the two policy fields of the session writes (design D12,
D34): `target_permission`, and how the resolver sends `start_session`,
`send_session_message` and `cancel_session` to the runner."""

from __future__ import annotations

from typing import Sequence

import pytest

from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.permission_rules import wire_author_permission_rules
from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolution,
    PlatformToolConfig,
    ResolvedToolSet,
    ToolCallback,
    ToolResolver,
    coerce_tool_configs,
)
from agenta.sdk.agents.tools.models import SESSION_WRITE_CALL_REFS, target_permission
from agenta.sdk.agents.wire_models import WireResolvedToolSpec

from ..test_agent_composition_seam import _FakeBackend, _no_connection, _request

_OPS = ("start_session", "send_session_message", "cancel_session")


# --------------------------------------------------------------------------- #
# target_permission
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "tool, entry, expected",
    [
        ("allow", None, "allow"),
        ("ask", None, "ask"),
        ("deny", None, "deny"),
        ("allow", "allow", "allow"),
        ("allow", "ask", "ask"),
        ("allow", "deny", "deny"),
        ("ask", "allow", "ask"),
        ("ask", "deny", "deny"),
        ("deny", "allow", "deny"),
        ("deny", "ask", "deny"),
    ],
)
def test_target_permission_is_the_stricter_of_the_two(tool, entry, expected):
    assert target_permission(tool, entry) == expected


def test_the_session_writes_are_the_three_call_refs():
    assert SESSION_WRITE_CALL_REFS == {f"tools.agenta.{op}" for op in _OPS}


# --------------------------------------------------------------------------- #
# The resolver
# --------------------------------------------------------------------------- #
class _Platform:
    """One handler-mode spec per platform config, as the catalog resolver builds it."""

    async def resolve(
        self, tools: Sequence[PlatformToolConfig], *, permission_default="allow_reads"
    ) -> GatewayToolResolution:
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.op,
                    description=tool.op,
                    call_ref=f"tools.agenta.{tool.op}",
                    permission=tool.permission,
                    read_only=tool.op == "list_agents",
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
        )


class _Workflows:
    """One reference spec per Subagent entry."""

    async def resolve(self, references):
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=f"call_{ref.slug.replace('-', '_')}"
                    + (f"_{ref.environment}" if ref.environment else ""),
                    description=ref.slug,
                    call_ref=f"workflow.variant.{ref.slug}",
                    permission=ref.permission,
                )
                for ref in references
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
        )


def _platform(op: str, permission=None) -> dict:
    entry = {"type": "platform", "op": op}
    if permission is not None:
        entry["permission"] = permission
    return entry


def _reference(slug: str, permission=None, **extra) -> dict:
    entry = {"type": "reference", "slug": slug, **extra}
    if permission is not None:
        entry["permission"] = permission
    return entry


async def _resolve(entries: list, *, mode="allow", rules=()):
    resolved = await ToolResolver(
        platform_resolver=_Platform(), workflow_resolver=_Workflows()
    ).resolve(
        coerce_tool_configs(entries).tool_configs,
        permission_default=mode,
        session_id="s-1",
        permission_rules=rules,
    )
    return {spec.name: spec for spec in resolved.tool_specs}


async def test_chief_of_staff_sends_its_session_writes_as_ask_with_both_fields():
    """'Chief of staff' in mode `allow`: 'Email writer' asks, 'Blog writer' sets nothing."""
    specs = await _resolve(
        [
            *(_platform(op) for op in _OPS),
            _reference("email-writer", "ask"),
            _reference("blog-writer"),
        ]
    )
    for op in _OPS:
        assert specs[op].permission == "ask"
        assert specs[op].configured_permission == "allow"
        # Only entries that set a permission, keyed by the entry's slug.
        assert specs[op].target_permissions == {"email-writer": "ask"}
    # The Subagent tools themselves keep their own permission.
    assert specs["call_email_writer"].permission == "ask"
    assert specs["call_email_writer"].configured_permission is None
    assert specs["call_blog_writer"].permission is None


async def test_a_deny_session_write_stays_deny():
    specs = await _resolve([_platform("start_session", "deny")])
    assert specs["start_session"].permission == "deny"
    assert specs["start_session"].configured_permission == "deny"


async def test_the_configured_permission_comes_from_the_tool_or_the_agent_mode():
    specs = await _resolve(
        [_platform("start_session", "allow"), _platform("send_session_message")],
        mode="allow_reads",
    )
    # The author's own permission.
    assert specs["start_session"].configured_permission == "allow"
    # No permission on the tool: a write under `allow_reads` asks.
    assert specs["send_session_message"].configured_permission == "ask"
    assert specs["send_session_message"].permission == "ask"


def _rules(**lists) -> list:
    return wire_author_permission_rules(lists)


@pytest.mark.parametrize(
    "mode, rules, expected_permission, expected_configured",
    [
        # An authored deny on the tool stays deny at the runner.
        ("allow", _rules(deny=["start_session"]), "deny", "deny"),
        # An authored ask is not lost: the server reads `ask`.
        ("allow", _rules(ask=["start_session"]), "ask", "ask"),
        # An authored allow wins over the mode, as at the runner.
        ("ask", _rules(allow=["start_session"]), "ask", "allow"),
        # The strictest rule that names the tool wins, as at the runner.
        (
            "allow",
            _rules(allow=["start_session"], deny=["start_session"]),
            "deny",
            "deny",
        ),
        # A rule with an argument prefix can only make every call stricter.
        ("allow", _rules(deny=["start_session(email:*)"]), "deny", "deny"),
        ("ask", _rules(allow=["start_session(email:*)"]), "ask", "ask"),
        # A rule for another tool changes nothing.
        ("allow", _rules(deny=["cancel_session", "start"]), "ask", "allow"),
    ],
)
async def test_the_configured_permission_keeps_the_authored_rules(
    mode, rules, expected_permission, expected_configured
):
    specs = await _resolve([_platform("start_session")], mode=mode, rules=rules)
    assert specs["start_session"].permission == expected_permission
    assert specs["start_session"].configured_permission == expected_configured


async def test_the_tools_own_permission_wins_over_a_rule_as_at_the_runner():
    specs = await _resolve(
        [_platform("start_session", "ask")], rules=_rules(allow=["start_session"])
    )
    assert specs["start_session"].configured_permission == "ask"


async def test_the_agent_handler_passes_the_authored_rules_to_the_resolver():
    seen: dict = {}

    async def _resolve_tools(tools, **kwargs):
        seen.update(kwargs)
        return ResolvedToolSet()

    comp = AgentComposition(
        select_backend=lambda template: _FakeBackend(),
        resolve_connection=_no_connection,
        resolve_tools=_resolve_tools,
    )
    await make_agent_handler(comp)(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters={
            "agent": {
                "harness": {
                    "kind": "pi_core",
                    "permissions": {"deny": ["start_session"]},
                }
            }
        },
    )
    assert seen["permission_rules"] == [
        {"pattern": "start_session", "permission": "deny"}
    ]


async def test_two_entries_for_one_slug_keep_the_stricter_permission():
    specs = await _resolve(
        [
            _platform("start_session"),
            _reference("email-writer", "allow"),
            _reference(
                "email-writer", "deny", ref_by="environment", environment="production"
            ),
        ]
    )
    assert specs["start_session"].target_permissions == {"email-writer": "deny"}


async def test_other_platform_ops_do_not_change():
    specs = await _resolve([_platform("list_agents"), _platform("commit_revision")])
    for name in ("list_agents", "commit_revision"):
        assert specs[name].permission is None
        assert specs[name].configured_permission is None
        assert specs[name].target_permissions is None


# --------------------------------------------------------------------------- #
# The wire
# --------------------------------------------------------------------------- #
async def test_the_two_fields_ride_the_wire_with_their_camel_case_names():
    specs = await _resolve(
        [_platform("start_session"), _reference("email-writer", "ask")]
    )
    wire = specs["start_session"].to_wire()
    assert wire["permission"] == "ask"
    assert wire["configuredPermission"] == "allow"
    assert wire["targetPermissions"] == {"email-writer": "ask"}
    assert "configured_permission" not in wire
    # The wire mirror reads the same names back.
    mirror = WireResolvedToolSpec.model_validate(wire)
    assert mirror.configured_permission == "allow"
    assert mirror.target_permissions == {"email-writer": "ask"}
    # And the spec reads its own wire form back.
    assert CallbackToolSpec.model_validate(wire) == specs["start_session"]


async def test_a_spec_with_no_policy_fields_has_none_on_the_wire():
    specs = await _resolve([_platform("list_agents")])
    wire = specs["list_agents"].to_wire()
    assert "configuredPermission" not in wire
    assert "targetPermissions" not in wire
