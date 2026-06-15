"""Pi harness adapter: drives the TypeScript Pi wrapper in ``services/agent``.

The transport is a one-shot JSON-over-stdio call: we send the run request as JSON on
the wrapper's stdin and read its JSON result from stdout. This is the "json adapter"
the design doc describes. A long-lived RPC adapter (``pi --mode rpc``) can replace it
later behind this same Harness port without touching the service.
"""

import json
import os
from typing import List, Optional, Sequence

from agenta.sdk.utils.logging import get_module_logger

from .ports import Harness, HarnessRequest, HarnessResult, Runtime

log = get_module_logger(__name__)

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_TIMEOUT", "180"))
_DEFAULT_COMMAND = ["pnpm", "exec", "tsx", "src/cli.ts"]


class PiHarness(Harness):
    def __init__(
        self,
        runtime: Runtime,
        *,
        wrapper_dir: str,
        command: Optional[Sequence[str]] = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._runtime = runtime
        self._wrapper_dir = wrapper_dir
        self._command: List[str] = list(command or _DEFAULT_COMMAND)
        self._timeout = timeout

    async def setup(self) -> None:
        await self._runtime.start()

    async def shutdown(self) -> None:
        await self._runtime.shutdown()

    async def invoke(self, request: HarnessRequest) -> HarnessResult:
        payload = json.dumps(
            {
                "agentsMd": request.agents_md,
                "model": request.model,
                "prompt": request.prompt,
                "messages": request.messages,
                "tools": request.tools,
                "trace": request.trace.to_wire() if request.trace else None,
            }
        ).encode("utf-8")

        result = await self._runtime.exec(
            self._command,
            payload,
            cwd=self._wrapper_dir,
            env={**os.environ},
            timeout=self._timeout,
        )

        if not result.stdout.strip():
            raise RuntimeError(
                "Pi wrapper returned no output. "
                f"exit={result.code} stderr={result.stderr[-2000:]}"
            )

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "Pi wrapper returned invalid JSON. "
                f"stdout={result.stdout[:500]} stderr={result.stderr[-1000:]}"
            ) from exc

        if not data.get("ok"):
            raise RuntimeError(f"Pi run failed: {data.get('error')}")

        return HarnessResult(
            output=data.get("output", ""),
            session_id=data.get("sessionId"),
            model=data.get("model"),
        )
