"""Unit tests for `MockMCPAdapter`.

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import re
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


#: Every request but `initialize` must carry the version the server NEGOTIATED, which this mock
#: answers with whatever the client offered (D64), so the default headers for these cases carry
#: it. The rule itself is asserted by its own cases at the bottom of the file.
NEGOTIATED = {"mcp-protocol-version": "2025-03-26"}


def _body(result: MCPRelayResult) -> dict:
    """The answer to the request, whether it arrived plain or inside an SSE stream.

    The stream may carry a notification before the answer (D63), so this selects the last
    event carrying a `result` or an `error` rather than joining every `data:` line. A helper
    that joined them is exactly the defect D63 found in the client, and a test helper with
    the bug in it cannot notice the bug.
    """
    text = result.body.decode().strip()
    frames = []
    for event in re.split(r"\r?\n\r?\n", text):
        data = [
            line[5:].strip() for line in event.splitlines() if line.startswith("data:")
        ]
        payload = "\n".join(data) if data else event.strip()
        if payload:
            frames.append(payload)
    for frame in reversed(frames):
        parsed = json.loads(frame)
        if "result" in parsed or "error" in parsed:
            return parsed
    return json.loads(frames[-1])


def _events(result: MCPRelayResult) -> list[dict]:
    """Every JSON-RPC payload in an answer, in order, notifications included."""
    text = result.body.decode().strip()
    out = []
    for event in re.split(r"\r?\n\r?\n", text):
        data = [
            line[5:].strip() for line in event.splitlines() if line.startswith("data:")
        ]
        payload = "\n".join(data) if data else event.strip()
        if payload:
            out.append(json.loads(payload))
    return out


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
        "supportedVersions": ["2025-03-26"],
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
    # The SERVER's revision comes back, not the client's offer: this mock speaks one revision and
    # negotiates a client that offers a newer one down to it, the way a real server does (D64).
    assert payload["result"] == {
        "protocolVersion": "2025-03-26",
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

    assert json.loads(result.body)["result"]["protocolVersion"] == "2025-03-26"


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
        body=_rpc("initialize", params={"protocolVersion": "2025-06-18"}),
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 400
    payload = _body(result)
    assert payload["error"]["code"] == -32020
    assert "headers and body disagree" in payload["error"]["message"]
    assert "MCP-Protocol-Version" in payload["error"]["message"]
    assert payload["error"]["data"]["mismatch"]["header"] == "2025-03-26"


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


# The same lesson, one protocol field along: `_meta` is optional everywhere in MCP, so a client
# can stamp one and no mock will mind — while a real upstream validates the whole envelope and
# refuses the request. OR91.


@pytest.mark.asyncio
async def test_a_reserved_meta_envelope_is_refused():
    """Exactly what a real upstream answered `tools/list` with, and the reason this rule exists."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc(
            "tools/list",
            params={"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}},
        ),
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 400
    payload = _body(result)
    assert payload["error"]["code"] == -32602
    assert "Invalid _meta envelope for protocol revision" in payload["error"]["message"]
    assert payload["error"]["data"]["key"] == "io.modelcontextprotocol/protocolVersion"


@pytest.mark.asyncio
async def test_a_notification_is_held_to_the_meta_rule_too():
    """`notifications/initialized` is the handshake's second call, so a client that stamps the
    envelope gets told there rather than passing until the first real server sees it."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="notifications/initialized"),
        body=json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {
                    "_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}
                },
            }
        ).encode(),
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 400
    assert _body(result)["error"]["code"] == -32602


@pytest.mark.asyncio
async def test_initialize_may_carry_a_meta_envelope():
    """Before `initialize` answers there is no revision in force to validate an envelope against,
    so the handshake's opening call is the one request this rule cannot apply to."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="initialize"),
        body=_rpc(
            "initialize",
            params={
                "protocolVersion": "2025-06-18",
                "_meta": {"io.modelcontextprotocol/protocolVersion": "2025-06-18"},
            },
        ),
        headers={},
    )

    assert result.status_code == 200
    assert _body(result)["result"]["protocolVersion"] == "2025-03-26"


@pytest.mark.asyncio
async def test_a_client_owned_meta_key_passes_through():
    """Scoped to the `io.modelcontextprotocol/` namespace, which is the server's to set. The
    spec's own client-side keys — a `progressToken`, say — are none of this fixture's business,
    and refusing them would booby-trap the next feature that legitimately needs one."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/call"),
        body=_rpc(
            "tools/call",
            params={
                "name": "echo",
                "arguments": {"hello": "world"},
                "_meta": {"progressToken": "abc123"},
            },
        ),
        headers=dict(NEGOTIATED),
    )

    assert result.status_code == 200
    assert _body(result)["result"]["isError"] is False


# D63. The transport lets a server send notifications before the response to a request. A client
# that joined every `data:` line got two JSON documents separated by a newline, parsed nothing,
# reported no tools and dropped the server. A single-event mock could never show that, so the one
# SSE-framed method sends a notification first and every cell in the matrix now carries it.


@pytest.mark.asyncio
async def test_tools_list_sends_a_notification_before_its_result():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list", request_id=7),
        headers=dict(NEGOTIATED),
    )

    events = _events(result)
    assert len(events) == 2, events
    prelude, answer = events

    # The notification: a method, no id, and nothing owed to any request. That is what a client
    # has to recognise and skip.
    assert prelude["method"] == "notifications/message"
    assert "id" not in prelude
    assert "result" not in prelude and "error" not in prelude

    # The answer, carrying the id of the request that asked.
    assert answer["id"] == 7
    assert {tool["name"] for tool in answer["result"]["tools"]} == {
        "echo",
        "fail",
        "slow",
    }


@pytest.mark.asyncio
async def test_the_notification_precedes_the_answer_on_the_wire():
    """Order matters: a reader that took the LAST data line would pass either way, and a reader
    that took the FIRST would pass only on the order no real server guarantees."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers=dict(NEGOTIATED),
    )

    text = result.body.decode()
    assert text.index("notifications/message") < text.index('"tools"')
    assert text.count("event: message") == 2


# D64. One product shipped three MCP clients naming two different revisions, and a mock that
# echoed the client's own offer back could never show the difference between the version a client
# OFFERS and the version a server ANSWERS. This mock now speaks one revision, older than the one
# the clients offer, so the downgrade runs in every cell.


@pytest.mark.asyncio
async def test_initialize_negotiates_a_newer_offer_down():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="initialize"),
        body=_rpc("initialize", params={"protocolVersion": "2026-07-28"}),
        headers={},
    )

    assert _body(result)["result"]["protocolVersion"] == "2025-03-26"


@pytest.mark.asyncio
async def test_a_later_request_must_name_the_negotiated_version_not_the_offered_one():
    """The defect a real upstream found: a client that echoes what it ASKED for rather than what
    it was ANSWERED. A mock checking only that the header exists cannot tell those apart."""
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers={"mcp-protocol-version": "2025-06-18"},  # what the client offered
    )

    assert result.status_code == 400
    payload = _body(result)
    assert payload["error"]["code"] == -32020
    assert (
        "which is not the 2025-03-26 this server negotiated"
        in payload["error"]["message"]
    )


@pytest.mark.asyncio
async def test_the_negotiated_version_is_accepted():
    adapter = MockMCPAdapter()

    result = await adapter.relay(
        route=_route(),
        auth=_auth(),
        context=MCPCallContext(method="tools/list"),
        body=_rpc("tools/list"),
        headers={"mcp-protocol-version": "2025-03-26"},
    )

    assert result.status_code == 200
