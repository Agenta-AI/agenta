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
    assert payload["result"]["resultType"] == "complete"
    assert payload["result"]["ttlMs"] == 300000
    assert payload["result"]["cacheScope"] == "public"


@pytest.mark.asyncio
async def test_discovery_advertises_the_current_protocol():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="server/discover"),
        body=_rpc("server/discover"),
        headers={},
    )

    payload = json.loads(result.body)
    assert payload["result"] == {
        "resultType": "complete",
        "supportedVersions": ["2026-07-28"],
        "capabilities": {"tools": {}},
        "_meta": {
            "io.modelcontextprotocol/serverInfo": {
                "name": "agenta-mock-mcp",
                "version": "0.1.0",
            }
        },
        "ttlMs": 300000,
        "cacheScope": "public",
    }


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
    assert payload["result"]["resultType"] == "complete"
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


# --- the opening handshake ---------------------------------------------------- #
#
# A spec-compliant MCP client sends `initialize`, then `notifications/initialized`, and only
# then reaches `tools/list`. The mock used to answer the first two with a transport failure, so
# Claude Code and Codex could never finish a handshake against it and Pi passed only because
# its extension calls `tools/list` directly.


@pytest.mark.asyncio
async def test_initialize_completes_the_handshake():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="initialize"),
        body=_rpc(
            "initialize",
            params={
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0"},
            },
        ),
        headers={},
    )

    assert result.status_code == 200
    payload = json.loads(result.body)
    assert payload["id"] == 1
    # The client's own version comes back: a fixture accepts whatever version it is opened
    # with, because rejecting one is a real server's job.
    assert payload["result"] == {
        "protocolVersion": "2025-06-18",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "agenta-mock-mcp", "version": "0.1.0"},
    }


@pytest.mark.asyncio
async def test_initialize_without_a_version_uses_the_pinned_one():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="initialize"),
        body=_rpc("initialize", params={}),
        headers={},
    )

    assert json.loads(result.body)["result"]["protocolVersion"] == "2026-07-28"


@pytest.mark.asyncio
async def test_initialized_notification_is_accepted_with_no_body():
    adapter = MockMCPAdapter()
    payload = json.dumps(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
    ).encode()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="notifications/initialized"),
        body=payload,
        headers={},
    )

    # Answering a notification is itself a protocol violation, so there is no body to read.
    assert result.status_code == 202
    assert result.body == b""


@pytest.mark.asyncio
async def test_any_notification_is_accepted_rather_than_answered():
    """The rule is JSON-RPC's own: no `id` means no response, whatever the method."""
    adapter = MockMCPAdapter()
    payload = json.dumps(
        {"jsonrpc": "2.0", "method": "notifications/cancelled"}
    ).encode()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="notifications/cancelled"),
        body=payload,
        headers={},
    )

    assert result.status_code == 202
    assert result.body == b""


@pytest.mark.asyncio
async def test_ping_answers_an_empty_result():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="ping"),
        body=_rpc("ping"),
        headers={},
    )

    assert json.loads(result.body) == {"jsonrpc": "2.0", "id": 1, "result": {}}


@pytest.mark.asyncio
async def test_unrecognized_method_is_a_json_rpc_error_not_a_transport_failure():
    """An unknown method is the server answering. Raising made the two tiers disagree: the
    in-process route answered 502 with a text detail and the socket route 501 with a bare
    string, so no client could read one shape from either."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="resources/list"),
        body=_rpc("resources/list"),
        headers={},
    )

    assert result.status_code == 200
    assert json.loads(result.body) == {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {"code": -32601, "message": "method not found: resources/list"},
    }
