"""A platform op may carry its own default permission. It applies only when
the author set none on the tool and the agent-wide mode is the default
`allow_reads`; an author's per-tool choice and any other agent-wide mode win."""

from __future__ import annotations

import pytest

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import AgentaPlatformToolResolver, PlatformOp
from agenta.sdk.agents.platform import op_catalog
from agenta.sdk.agents.tools import ToolResolver

pytestmark = pytest.mark.asyncio

_OP = "test_default_allow_op"


@pytest.fixture(autouse=True)
def _op_with_a_default(monkeypatch):
    monkeypatch.setitem(
        op_catalog.PLATFORM_OPS,
        _OP,
        PlatformOp(
            op=_OP,
            description="a write whose catalog default is allow",
            method="POST",
            path="/api/test",
            input_schema={"type": "object", "properties": {}},
            read_only=False,
            default_permission="allow",
        ),
    )


async def _permission(connection, *, permission=None, mode="allow_reads", op=_OP):
    resolution = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op=op, permission=permission)],
        permission_default=mode,
    )
    return resolution.tool_specs[0].permission


async def test_op_default_applies_when_author_set_nothing_under_allow_reads(connection):
    assert await _permission(connection) == "allow"


@pytest.mark.parametrize("authored", ["ask", "deny"])
async def test_author_choice_wins_over_op_default(connection, authored):
    assert await _permission(connection, permission=authored) == authored


@pytest.mark.parametrize("mode", ["ask", "deny", "allow"])
async def test_agent_wide_mode_ignores_op_default(connection, mode):
    # no spec permission: the runner applies the agent-wide mode itself
    assert await _permission(connection, mode=mode) is None


async def test_ops_without_default_are_unchanged(connection):
    assert await _permission(connection, op="discover_tools") is None


async def test_tool_resolver_passes_the_agent_wide_mode(connection):
    resolver = ToolResolver(
        platform_resolver=AgentaPlatformToolResolver(connection=connection)
    )

    under_default = await resolver.resolve([PlatformToolConfig(op=_OP)])
    under_ask = await resolver.resolve(
        [PlatformToolConfig(op=_OP)], permission_default="ask"
    )

    assert under_default.tool_specs[0].permission == "allow"
    assert under_ask.tool_specs[0].permission is None


def test_default_permission_is_allow_or_ask_only():
    with pytest.raises(ValueError):
        PlatformOp(
            op="bad",
            description="x",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            default_permission="deny",
        )
