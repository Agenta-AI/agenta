"""The two harness transports: subprocess and HTTP.

Both speak the same ``/run`` wire contract (see ``wire.py``) and differ only in how they
reach the TypeScript runner:

- ``SubprocessHarness`` spawns the TS CLI through an :class:`Environment`, handing it the
  request on stdin. It sets ``AGENT_BACKEND`` to pick the engine (``rivet`` for the ACP
  path, ``pi`` for the legacy in-process Pi path).
- ``HttpHarness`` POSTs to the wrapper running as a sidecar. The sidecar auto-routes to the
  engine by request shape (a rivet request carries ``harness``/``sandbox``), so the
  transport itself stays engine-agnostic.

The engine is therefore config, not a Python class. This is what collapsed the old
``PiHarness`` / ``PiHttpHarness`` / ``RivetHarness`` trio into two transports.
"""

from __future__ import annotations

import json
import os
from typing import List, Optional, Sequence

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .ports import AgentRequest, AgentResult, Environment, EventSink, Harness
from .wire import request_to_wire, result_from_wire

log = get_module_logger(__name__)

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_TIMEOUT", "180"))
_DEFAULT_COMMAND = ["pnpm", "exec", "tsx", "src/cli.ts"]


def _emit_events(result: AgentResult, on_event: Optional[EventSink]) -> None:
    """Replay the result's event log to a live sink.

    The one-shot transports receive the whole run at once, so events arrive as a batch
    rather than live. Firing them here keeps the ``on_event`` API working; true streaming
    (NDJSON over ``/run``) is a documented follow-on.
    """
    if not on_event:
        return
    for event in result.events:
        try:
            on_event(event)
        except Exception:  # pylint: disable=broad-except
            log.warning("agent: on_event sink raised", exc_info=True)


class SubprocessHarness(Harness):
    """Drive the TS runner as a subprocess on this host, request on stdin.

    ``backend`` selects the engine via ``AGENT_BACKEND`` (``rivet`` or ``pi``).
    """

    def __init__(
        self,
        environment: Environment,
        *,
        wrapper_dir: str,
        backend: str = "rivet",
        command: Optional[Sequence[str]] = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._environment = environment
        self._wrapper_dir = wrapper_dir
        self._backend = backend
        self._command: List[str] = list(command or _DEFAULT_COMMAND)
        self._timeout = timeout

    async def setup(self) -> None:
        await self._environment.start()

    async def shutdown(self) -> None:
        await self._environment.dispose()

    async def invoke(
        self,
        request: AgentRequest,
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        wire = request_to_wire(request)
        wire["backend"] = self._backend
        payload = json.dumps(wire).encode("utf-8")
        exec_result = await self._environment.exec(
            self._command,
            payload,
            cwd=self._wrapper_dir,
            env={**os.environ, "AGENT_BACKEND": self._backend},
            timeout=self._timeout,
        )

        if not exec_result.stdout.strip():
            raise RuntimeError(
                "Agent runner returned no output. "
                f"exit={exec_result.code} stderr={exec_result.stderr[-2000:]}"
            )
        try:
            data = json.loads(exec_result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "Agent runner returned invalid JSON. "
                f"stdout={exec_result.stdout[:500]} stderr={exec_result.stderr[-1000:]}"
            ) from exc

        result = result_from_wire(data)
        _emit_events(result, on_event)
        return result


class HttpHarness(Harness):
    """Drive the TS runner over HTTP (the sidecar). The sidecar picks the engine."""

    def __init__(
        self,
        base_url: str,
        *,
        backend: str = "rivet",
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._backend = backend
        self._timeout = timeout

    async def invoke(
        self,
        request: AgentRequest,
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        payload = request_to_wire(request)
        payload["backend"] = self._backend
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f"{self._base_url}/run", json=payload)
        if response.status_code >= 500:
            raise RuntimeError(
                f"Agent runner HTTP {response.status_code}: {response.text[:1000]}"
            )

        result = result_from_wire(response.json())
        _emit_events(result, on_event)
        return result
