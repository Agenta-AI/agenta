"""The mock upstreams answer, and can still be driven to fail and to hang.

The mocks run as compose services and can fail or hang on demand through real HTTP clients.

Needs the compose stack up; skips with a reason when it is not.
"""

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

        # A tool failure is a protocol-level result, not a transport error.
        assert response.status_code == 200, response.text
        assert response.json()["result"]["isError"] is True
