"""The permission per target and the two policy fields of the session writes (design D12,
D34): `target_permission`, and how the resolver sends `start_session`,
`send_session_message` and `cancel_session` to the runner."""

from __future__ import annotations

from typing import Sequence

import pytest

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolution,
    PlatformToolConfig,
    ToolCallback,
    ToolResolver,
    coerce_tool_configs,
)
from agenta.sdk.agents.tools.models import SESSION_WRITE_CALL_REFS, target_permission
from agenta.sdk.agents.wire_models import WireResolvedToolSpec

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


async def _resolve(entries: list, *, mode="allow"):
    resolved = await ToolResolver(
        platform_resolver=_Platform(), workflow_resolver=_Workflows()
    ).resolve(
        coerce_tool_configs(entries).tool_configs,
        permission_default=mode,
        session_id="s-1",
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
