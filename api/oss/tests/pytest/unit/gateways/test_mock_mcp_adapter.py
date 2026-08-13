"""Unit tests for MockMcpAdapter (entities.md §7.1, workstreams/specs-wp5.md).

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import time

import pytest

from oss.src.core.gateways.mcps.dtos import (
    McpCallContext,
    McpDirectAuth,
    McpResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMcpAdapter
from oss.src.core.gateways.mcps.types import McpUpstreamError


def _route() -> McpResolvedRoute:
    return McpResolvedRoute(url="http://mock-mcp-gateway:9092/")


def _auth() -> McpDirectAuth:
    return McpDirectAuth(secret=None)


def _rpc(method: str, *, params=None, request_id=1) -> bytes:
    payload = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        payload["params"] = params
    return json.dumps(payload).encode()


@pytest.mark.asyncio
async def test_tools_list_returns_all_three_tools():
    adapter = MockMcpAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=McpCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers={},
    )

    assert isinstance(result, McpRelayResult)
    payload = json.loads(result.body)
    names = {tool["name"] for tool in payload["result"]["tools"]}
    assert names == {"echo", "fail", "slow"}


@pytest.mark.asyncio
async def test_echo_tool_echoes_arguments():
    adapter = MockMcpAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=McpCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "echo", "arguments": {"x": 1}}),
        headers={},
    )

    payload = json.loads(result.body)
    content = payload["result"]["content"][0]["text"]
    assert json.loads(content) == {"x": 1}
    assert payload["result"]["isError"] is False


@pytest.mark.asyncio
async def test_fail_tool_returns_error_result_not_exception():
    adapter = MockMcpAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=McpCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "fail"}),
        headers={},
    )

    assert result.status_code == 200
    payload = json.loads(result.body)
    assert payload["result"]["isError"] is True


@pytest.mark.asyncio
async def test_slow_tool_sleeps():
    adapter = MockMcpAdapter()
    start = time.monotonic()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=McpCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "slow", "arguments": {"seconds": 1}}),
        headers={},
    )
    elapsed = time.monotonic() - start

    assert elapsed >= 1
    payload = json.loads(result.body)
    assert payload["result"]["isError"] is False


@pytest.mark.asyncio
async def test_unrecognized_method_raises_upstream_error():
    adapter = MockMcpAdapter()

    with pytest.raises(McpUpstreamError) as excinfo:
        await adapter.relay(
            route=_route(),
            auth=_auth(),
            context=McpCallContext(method="resources/list"),
            body=_rpc("resources/list"),
            headers={},
        )

    assert excinfo.value.status_code == 501


@pytest.mark.asyncio
async def test_notification_returns_202_with_empty_body():
    adapter = MockMcpAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=McpCallContext(method="notifications/initialized"),
        body=_rpc("notifications/initialized"),
        headers={},
    )

    assert result.status_code == 202
    assert result.body == b""
