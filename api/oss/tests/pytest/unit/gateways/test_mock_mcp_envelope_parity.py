"""The two mock MCP tiers must answer a given request with the same bytes.

`MockMCPAdapter` is both the in-process upstream behind the builtin mock route and the whole
implementation behind the deployable app the custom route reaches over a socket. A client is
debugged against one and trusted against the other, so a divergence between them is a trap.
They diverged on exactly the case a client hits first when something is wrong: an unknown
method answered 502 with a text detail in-process and 501 with the bare string
"mock upstream request failed" over the socket.

Nothing running: the app is driven through Starlette's `TestClient`.
"""

import json

import pytest
from fastapi.testclient import TestClient

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
from oss.src.core.gateways.mcps.providers.mock.app import app

_HANDSHAKE = [
    ("initialize", {"protocolVersion": "2025-06-18"}),
    ("ping", None),
    ("server/discover", None),
    ("tools/list", None),
    ("tools/call", {"name": "echo", "arguments": {"x": 1}}),
    ("resources/list", None),
]


def _request(method: str, params) -> dict:
    payload = {"jsonrpc": "2.0", "id": 7, "method": method}
    if params is not None:
        payload["params"] = params
    return payload


async def _in_process(payload: dict):
    body = json.dumps(payload).encode()
    return await MockMCPAdapter().relay(
        route=MCPResolvedRoute(url="http://mock-mcp-gateway:9092/"),
        auth=MCPDirectAuth(secret=None),
        context=MCPCallContext(method=payload["method"]),
        body=body,
        headers={},
    )


@pytest.mark.parametrize("method,params", _HANDSHAKE, ids=[m for m, _ in _HANDSHAKE])
@pytest.mark.asyncio
async def test_both_tiers_answer_identically(method, params):
    payload = _request(method, params)

    direct = await _in_process(payload)
    with TestClient(app) as client:
        over_socket = client.post("/", json=payload)

    assert over_socket.status_code == direct.status_code
    assert over_socket.json() == json.loads(direct.body)


@pytest.mark.asyncio
async def test_both_tiers_accept_a_notification_with_no_body():
    payload = {"jsonrpc": "2.0", "method": "notifications/initialized"}

    direct = await _in_process(payload)
    with TestClient(app) as client:
        over_socket = client.post("/", json=payload)

    assert direct.status_code == 202
    assert over_socket.status_code == 202
    assert over_socket.content == b""


def test_the_socket_tier_speaks_json_rpc_for_an_unknown_method():
    """Named separately from the parity case above: this is the exact body the QA run found
    the two tiers disagreeing about, so it is pinned on its own."""
    with TestClient(app) as client:
        response = client.post(
            "/", json={"jsonrpc": "2.0", "id": 7, "method": "resources/list"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "jsonrpc": "2.0",
        "id": 7,
        "error": {"code": -32601, "message": "method not found: resources/list"},
    }
