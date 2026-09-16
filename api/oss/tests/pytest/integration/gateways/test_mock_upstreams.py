"""The mock upstreams answer, and can still be driven to fail and to hang.

The mocks run as compose services and can fail or hang on demand through real HTTP clients.

Needs the compose stack up; skips with a reason when it is not.
"""

import json
import socket
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

import httpx
import pytest

from oss.src.utils.env import env


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@lru_cache(maxsize=2)
def _resolve(url: str, default_port: int) -> Optional[str]:
    """The compose service name in-network, else the published loopback port.

    Both dev compose files publish these on 127.0.0.1, so a host-side run reaches the
    same containers without the env var having to lie to the API container, which needs
    the service name.
    """
    parsed = urlparse(url)
    port = parsed.port or default_port
    if parsed.hostname and _reachable(parsed.hostname, port):
        return url
    if _reachable("127.0.0.1", port):
        return f"http://127.0.0.1:{port}"
    return None


_LLM_URL = _resolve(env.mock_gateways.llm_url, 9091)
_MCP_URL = _resolve(env.mock_gateways.mcp_url, 9092)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        _LLM_URL is None or _MCP_URL is None,
        reason="mock gateway services not reachable — deploy the compose stack",
    ),
]


async def _negotiated_mcp_headers(client: httpx.AsyncClient) -> dict:
    """Handshake with the mock MCP server and return the headers a session must then send.

    The mock enforces the protocol version the way a conforming server does: every request
    after `initialize` must carry `MCP-Protocol-Version`, and it must be the version the
    server actually negotiated rather than the one the client asked for (D54). These cases
    used to send neither, and passed only because the mock was obliging.

    Read from the handshake rather than written down here, so a mock that negotiates a
    different version keeps these cases honest instead of pinning a string that has to be
    updated in two places.
    """
    handshake = await client.post(
        "/",
        json={
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "agenta-tests", "version": "0"},
            },
        },
    )
    assert handshake.status_code == 200, handshake.text
    negotiated = handshake.json()["result"]["protocolVersion"]
    return {"MCP-Protocol-Version": negotiated}


def _jsonrpc_result(response: httpx.Response) -> dict:
    """The JSON-RPC result, whichever framing the server chose.

    A Streamable HTTP server may answer a single request as an event stream, and may send
    notifications before the response, so the answer is the frame carrying this id rather
    than the body or the last frame. The mock does exactly that now (D54, D62/D63), and
    these cases used to assume one plain JSON object.
    """
    body = response.text
    if "data:" not in body:
        return response.json()["result"]
    payloads = [
        json.loads(line[len("data:") :].strip())
        for line in body.splitlines()
        if line.startswith("data:")
    ]
    answers = [p for p in payloads if isinstance(p.get("result"), dict)]
    assert answers, body
    return answers[-1]["result"]


async def _every_listed_tool(client: httpx.AsyncClient, headers: dict) -> set:
    """Every tool the server offers, following its pagination.

    The mock pages one tool at a time on purpose. A caller that reads only the first page
    sees one tool and calls it the catalogue, which is what a gateway must not do.
    """
    names: set = set()
    cursor = None
    for request_id in range(1, 20):
        params = {"cursor": cursor} if cursor else {}
        response = await client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": params,
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
        result = _jsonrpc_result(response)
        names.update(tool["name"] for tool in result.get("tools", []))
        cursor = result.get("nextCursor")
        if not cursor:
            return names
    raise AssertionError("the mock paginated further than any real catalogue would")


class TestMockUpstreams:
    async def test_both_healthchecks_answer(self):
        async with httpx.AsyncClient() as client:
            llm = await client.get(f"{_LLM_URL}/health")
            mcp = await client.get(f"{_MCP_URL}/health")

        assert llm.status_code == 200, llm.text
        assert mcp.status_code == 200, mcp.text

    async def test_error_model_returns_500(self):
        async with httpx.AsyncClient(base_url=_LLM_URL) as client:
            response = await client.post(
                "/v1/chat/completions", json={"model": "mock/error", "messages": []}
            )

        assert response.status_code == 500, response.text

    async def test_echo_model_streams_sse_frames_ending_done(self):
        async with httpx.AsyncClient(base_url=_LLM_URL) as client:
            async with client.stream(
                "POST",
                "/v1/chat/completions",
                json={
                    "model": "mock/echo",
                    "stream": True,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            ) as response:
                content_type = response.headers["content-type"]
                frames = [
                    line
                    async for line in response.aiter_lines()
                    if line.startswith("data:")
                ]

        assert content_type.startswith("text/event-stream"), content_type
        assert len(frames) > 1, frames
        assert frames[-1] == "data: [DONE]", frames[-1]

    async def test_slow_model_hangs_past_a_short_client_timeout(self):
        # A real socket left open, not a mocked await: without this the gateway's own
        # timeout handling has nothing to time out against.
        async with httpx.AsyncClient(base_url=_LLM_URL, timeout=2.0) as client:
            with pytest.raises(httpx.TimeoutException):
                await client.post(
                    "/v1/chat/completions",
                    json={"model": "mock/slow-30", "messages": []},
                )

    async def test_tools_list_returns_three_tools_and_get_delete_are_405(self):
        async with httpx.AsyncClient(base_url=_MCP_URL) as client:
            headers = await _negotiated_mcp_headers(client)
            listed = await _every_listed_tool(client, headers)
            got = await client.get("/", headers=headers)
            deleted = await client.delete("/", headers=headers)

        assert listed == {"echo", "fail", "slow"}
        assert got.status_code == 405
        assert deleted.status_code == 405

    async def test_failing_tool_returns_is_error_at_http_200(self):
        async with httpx.AsyncClient(base_url=_MCP_URL) as client:
            response = await client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "fail"},
                },
                headers=await _negotiated_mcp_headers(client),
            )

        # A tool failure is a protocol-level result, not a transport error.
        assert response.status_code == 200, response.text
        assert _jsonrpc_result(response)["isError"] is True
