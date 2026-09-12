"""OR32: the runner's "this MCP server did not connect" notice must reach the client.

The egress is an ``elif`` chain with no fallthrough, so an event type it does not name is
dropped without a word. That is exactly how the handshake failure used to disappear on the way
to the browser, and the two cases below are what stops it returning.
"""

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.streaming import AgentStream


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


NOTICE = {
    "serverName": "gw-mock-mcp",
    "reasonCode": "handshake_http_error",
    "status": 501,
    "message": "MCP server gw-mock-mcp failed to connect: 501",
}


@pytest.mark.asyncio
async def test_live_stream_projects_the_failed_mcp_server() -> None:
    events = _records([{"type": "mcp_server_failed", "data": NOTICE}])

    parts = [part async for part in agent_stream_to_vercel_stream(events)]

    notice = next(part for part in parts if part["type"] == "data-mcp-server-failed")
    assert notice == {"type": "data-mcp-server-failed", "data": NOTICE}
    # A notice, not a failure: nothing on this stream ends the message.
    assert not [part for part in parts if part["type"] == "error"]


@pytest.mark.asyncio
async def test_batch_twin_projects_the_failed_mcp_server() -> None:
    records = [
        {"kind": "event", "event": {"type": "mcp_server_failed", **NOTICE}},
        {"kind": "result", "result": {"ok": True}},
    ]
    run = AgentStream(_records(records))

    parts = [part async for part in agent_run_to_vercel_parts(run)]

    notice = next(part for part in parts if part["type"] == "data-mcp-server-failed")
    assert notice == {"type": "data-mcp-server-failed", "data": NOTICE}


@pytest.mark.asyncio
async def test_a_notice_without_a_status_keeps_its_code_and_sentence() -> None:
    """An unreachable server answers nothing, so there is no status to carry."""
    events = _records(
        [
            {
                "type": "mcp_server_failed",
                "data": {
                    "serverName": "gw-mock-mcp",
                    "reasonCode": "handshake_unreachable",
                    "status": None,
                    "message": "MCP server gw-mock-mcp failed to connect: handshake_unreachable",
                },
            }
        ]
    )

    parts = [part async for part in agent_stream_to_vercel_stream(events)]

    notice = next(part for part in parts if part["type"] == "data-mcp-server-failed")
    assert notice["data"] == {
        "serverName": "gw-mock-mcp",
        "reasonCode": "handshake_unreachable",
        "message": "MCP server gw-mock-mcp failed to connect: handshake_unreachable",
    }
