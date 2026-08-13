"""The mock upstreams answer, and can still be driven to fail and to hang.

WP5's own contract (workstreams/specs-wp5.md): the mocks must run as compose services and
be drivable to fail/hang on demand from a real HTTP client, not a mocked transport. Every
suite that points an endpoint at them inherits that assumption, so it is checked directly
here rather than left implicit.

Needs the compose stack: these address `mock-llm-gateway` / `mock-mcp-gateway` by service
name, so they only resolve from inside the network —
`docker compose -p <project> exec api python -m pytest oss/tests/pytest/integration/gateways`.
"""

import socket
from functools import lru_cache
from urllib.parse import urlparse

import httpx
import pytest

from oss.src.utils.env import env

_LLM_URL = env.mock_gateways.llm_url
_MCP_URL = env.mock_gateways.mcp_url


@lru_cache(maxsize=1)
def _mock_upstreams_reachable() -> bool:
    for url, default_port in ((_LLM_URL, 9091), (_MCP_URL, 9092)):
        parsed = urlparse(url)
        try:
            with socket.create_connection(
                (parsed.hostname or "", parsed.port or default_port), timeout=0.5
            ):
                continue
        except OSError:
            return False
    return True


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _mock_upstreams_reachable(),
        reason="mock gateway services not reachable — run inside the compose network",
    ),
]


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
            listed = await client.post(
                "/", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
            )
            got = await client.get("/")
            deleted = await client.delete("/")

        assert listed.status_code == 200, listed.text
        assert {tool["name"] for tool in listed.json()["result"]["tools"]} == {
            "echo",
            "fail",
            "slow",
        }
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
            )

        # A tool that fails is a protocol-level result, never a transport error (D16).
        assert response.status_code == 200, response.text
        assert response.json()["result"]["isError"] is True
