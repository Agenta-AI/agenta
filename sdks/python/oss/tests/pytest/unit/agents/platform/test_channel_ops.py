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
    assert set(CHANNEL_TOOL_OPS) >= {
        "list_channel_destinations",
        "send_channel_message",
    }


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


@pytest.mark.asyncio
async def test_send_channel_message_is_a_write_and_hides_session_and_tool_call(
    connection,
):
    spec = await _spec(connection, "send_channel_message")

    assert spec.read_only is False
    assert spec.call.path == "/api/channels/tools/messages/send"
    assert spec.call.context == {
        "artifact_id": "$ctx.workflow.artifact.id",
        "session_id": "$ctx.session.id",
        "tool_call_id": "$ctx.tool.call_id",
    }
    schema = get_platform_op("send_channel_message").resolved_input_schema()
    assert set(schema["properties"]) == {"destination_id", "text", "thread_id"}
    assert schema["required"] == ["destination_id", "text"]


@pytest.mark.asyncio
async def test_send_channel_message_defaults_to_allow(connection):
    default = await _spec(connection, "send_channel_message")
    resolution = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op="send_channel_message")], permission_default="ask"
    )

    assert default.permission == "allow"
    assert resolution.tool_specs[0].permission is None
