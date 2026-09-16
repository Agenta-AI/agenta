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


#: Every request but `initialize` must carry the negotiated version, so the default headers for
#: these cases carry it. The rule itself is asserted by its own cases at the bottom of the file.
NEGOTIATED = {"mcp-protocol-version": "2026-07-28"}


def _body(result: MCPRelayResult) -> dict:
    """The JSON of an answer, whether it arrived plain or inside an SSE event."""
    text = result.body.decode().strip()
    data = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
    return json.loads("\n".join(data) if data else text)


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
        headers=dict(NEGOTIATED),
    )

    assert isinstance(result, MCPRelayResult)
    # Framed as an SSE event, leading with the `event:` line, the way real servers answer.
    assert result.headers["content-type"] == "text/event-stream"
    assert result.body.decode().startswith("event: message\ndata: {")
    payload = _body(result)
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
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
        headers={},  # initialize negotiates the version; it must not assert one
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
        headers={},  # initialize negotiates the version; it must not assert one
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
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
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 200
    assert json.loads(result.body) == {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {"code": -32601, "message": "method not found: resources/list"},
    }


# The mock is strict about the protocol version for one reason: it was permissive, a client had
# the rule backwards, and every mock cell passed while a real upstream refused every turn. A
# fixture that accepts more than a real server accepts is a fixture that certifies nothing.


@pytest.mark.asyncio
async def test_initialize_carrying_a_version_header_is_refused():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="initialize"),
        body=_rpc("initialize", params={"protocolVersion": "2026-07-28"}),
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 400
    payload = _body(result)
    assert payload["error"]["code"] == -32020
    assert "headers and body disagree" in payload["error"]["message"]
    assert "MCP-Protocol-Version" in payload["error"]["message"]
    assert payload["error"]["data"]["mismatch"]["header"] == "2026-07-28"


@pytest.mark.asyncio
async def test_a_later_request_without_the_version_header_is_refused():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers={},
    )

    assert result.status_code == 400
    payload = _body(result)
    assert payload["error"]["code"] == -32020
    assert "without the MCP-Protocol-Version header" in payload["error"]["message"]


@pytest.mark.asyncio
async def test_a_notification_is_held_to_the_same_rule():
    """A notification is a post-initialization request like any other. Exempting it would let a
    client get the rule wrong on `notifications/initialized` and never be told."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="notifications/initialized"),
        body=json.dumps(
            {"jsonrpc": "2.0", "method": "notifications/initialized"}
        ).encode(),
        headers={},
    )

    assert result.status_code == 400
