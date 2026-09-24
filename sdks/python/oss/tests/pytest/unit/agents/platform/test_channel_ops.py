"""The channel agent tools in the platform-op catalog: which endpoint each
calls, which fields the runner binds from run context (hidden from the
model), and their read-only hints."""

from __future__ import annotations

import pytest

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import (
    CHANNEL_TOOL_OPS,
    AgentaPlatformToolResolver,
    get_platform_op,
)


async def _spec(connection, op):
    resolution = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op=op)]
    )
    return resolution.tool_specs[0]


def test_channel_tool_ops_are_the_kit_group():
    assert "list_channel_destinations" in CHANNEL_TOOL_OPS


@pytest.mark.asyncio
async def test_list_channel_destinations_is_read_only_and_hides_artifact_binding(
    connection,
):
    spec = await _spec(connection, "list_channel_destinations")

    assert spec.read_only is True
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/channels/tools/destinations/query"
    assert spec.call.context == {"artifact_id": "$ctx.workflow.artifact.id"}
    schema = get_platform_op("list_channel_destinations").resolved_input_schema()
    assert "artifact_id" not in schema["properties"]
    assert schema["additionalProperties"] is False
    assert set(schema["properties"]) == {"type", "query", "limit", "cursor"}
