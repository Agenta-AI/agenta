"""Unit tests for `MockMCPAdapter`.

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import time

import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
from oss.src.core.gateways.mcps.types import MCPUpstreamError


def _route() -> MCPResolvedRoute:
    return MCPResolvedRoute(url="http://mock-mcp-gateway:9092/")


def _auth() -> MCPDirectAuth:
    return MCPDirectAuth(secret=None)


def _rpc(method: str, *, params=None, request_id=1) -> bytes:
    payload = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        payload["params"] = params
    return json.dumps(payload).encode()


@pytest.mark.asyncio
async def test_tools_list_returns_all_three_tools():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers={},
    )

    assert isinstance(result, MCPRelayResult)
    payload = json.loads(result.body)
    names = {tool["name"] for tool in payload["result"]["tools"]}
    assert names == {"echo", "fail", "slow"}


@pytest.mark.asyncio
async def test_echo_tool_echoes_arguments():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "echo", "arguments": {"x": 1}}),
        headers={},
    )

    payload = json.loads(result.body)
    content = payload["result"]["content"][0]["text"]
    assert json.loads(content) == {"x": 1}
    assert payload["result"]["isError"] is False


@pytest.mark.asyncio
async def test_fail_tool_returns_error_result_not_exception():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "fail"}),
        headers={},
    )

    assert result.status_code == 200
    payload = json.loads(result.body)
    assert payload["result"]["isError"] is True


@pytest.mark.asyncio
async def test_slow_tool_sleeps():
    adapter = MockMCPAdapter()
    start = time.monotonic()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/call"),
        body=_rpc("tools/call", params={"name": "slow", "arguments": {"seconds": 1}}),
        headers={},
    )
    elapsed = time.monotonic() - start

    assert elapsed >= 1
    payload = json.loads(result.body)
    assert payload["result"]["isError"] is False


@pytest.mark.asyncio
async def test_unrecognized_method_raises_upstream_error():
    adapter = MockMCPAdapter()

    with pytest.raises(MCPUpstreamError) as excinfo:
        await adapter.relay(
            route=_route(),
            auth=_auth(),
            context=MCPCallContext(method="resources/list"),
            body=_rpc("resources/list"),
            headers={},
        )

    assert excinfo.value.status_code == 501


@pytest.mark.asyncio
async def test_notification_returns_202_with_empty_body():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="notifications/initialized"),
        body=_rpc("notifications/initialized"),
        headers={},
    )

    assert result.status_code == 202
    assert result.body == b""
