"""Pi harness adapter over HTTP.

Same Harness port as ``PiHarness`` (the local subprocess one), but talks to the Pi
wrapper running as a separate HTTP service (a sidecar container). The transport is a
JSON ``POST /run``. This is what the dockerized agent uses, since the Python service
container has no Node; the Pi wrapper runs in its own container.
"""

import os

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .ports import Harness, HarnessRequest, HarnessResult

log = get_module_logger(__name__)

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_TIMEOUT", "180"))


class PiHttpHarness(Harness):
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def setup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def invoke(self, request: HarnessRequest) -> HarnessResult:
        payload = {
            "agentsMd": request.agents_md,
            "model": request.model,
            "prompt": request.prompt,
            "messages": request.messages,
            "tools": request.tools,
            "customTools": request.custom_tools,
            "toolCallback": request.tool_callback.to_wire()
            if request.tool_callback
            else None,
            "trace": request.trace.to_wire() if request.trace else None,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f"{self._base_url}/run", json=payload)

        if response.status_code >= 500:
            raise RuntimeError(
                f"Pi wrapper HTTP {response.status_code}: {response.text[:1000]}"
            )

        data = response.json()
        if not data.get("ok"):
            raise RuntimeError(f"Pi run failed: {data.get('error')}")

        return HarnessResult(
            output=data.get("output", ""),
            session_id=data.get("sessionId"),
            model=data.get("model"),
        )
