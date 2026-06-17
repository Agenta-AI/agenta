"""Rivet harness adapter (WP-8): drives the agent over ACP via a rivet daemon.

Same ``Harness`` port as the Pi adapters, but the transport behind it runs the chosen
harness (Pi, Claude Code, ...) over the Agent Client Protocol through a rivet
``sandbox-agent`` daemon, rather than the bespoke Pi SDK calls. The ``/invoke`` contract
is unchanged; harness and sandbox become config values carried on the wire to the TS
runner (``runRivet.ts``, selected by ``AGENT_BACKEND=rivet``).

Two transports, mirroring the Pi adapters:

- HTTP (docker): POST the envelope to the wrapper running as a sidecar. Selected when a
  base URL is provided (``AGENTA_AGENT_PI_URL``); the sidecar runs in rivet mode.
- subprocess (local): spawn the TS CLI with ``AGENT_BACKEND=rivet`` and hand it the
  envelope over stdio.

The envelope adds ``harness``, ``sandbox``, and ``sessionId`` to the Pi-shaped fields;
everything else (agentsMd, model, prompt, messages, tools, customTools, toolCallback,
trace) is identical, so the Python side stays thin.
"""

import json
import os
from typing import List, Optional, Sequence

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .ports import Harness, HarnessRequest, HarnessResult, Runtime

log = get_module_logger(__name__)

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_TIMEOUT", "180"))
_DEFAULT_COMMAND = ["pnpm", "exec", "tsx", "src/cli.ts"]


def _rivet_payload(request: HarnessRequest, harness: str, sandbox: str) -> dict:
    """Build the wire envelope: the Pi-shaped fields plus harness/sandbox/sessionId."""
    return {
        "harness": harness,
        "sandbox": sandbox,
        "sessionId": request.session_id,
        "secrets": request.secrets or {},
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


def _to_result(data: dict) -> HarnessResult:
    if not data.get("ok"):
        raise RuntimeError(f"Rivet run failed: {data.get('error')}")
    return HarnessResult(
        output=data.get("output", ""),
        session_id=data.get("sessionId"),
        model=data.get("model"),
        usage=data.get("usage"),
    )


class RivetHarness(Harness):
    """Drive the harness over ACP via rivet, over HTTP or a local subprocess.

    Pass ``base_url`` for the HTTP sidecar transport; otherwise a ``runtime`` plus
    ``wrapper_dir`` runs the TS CLI as a subprocess. ``harness`` (pi/claude) and
    ``sandbox`` (local/daytona) are the two orthogonal swap axes.
    """

    def __init__(
        self,
        *,
        harness: str,
        sandbox: str,
        base_url: Optional[str] = None,
        runtime: Optional[Runtime] = None,
        wrapper_dir: Optional[str] = None,
        command: Optional[Sequence[str]] = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        if not base_url and not runtime:
            raise ValueError(
                "RivetHarness needs either base_url (HTTP) or runtime (subprocess)"
            )
        self._harness = harness
        self._sandbox = sandbox
        self._base_url = base_url.rstrip("/") if base_url else None
        self._runtime = runtime
        self._wrapper_dir = wrapper_dir
        self._command: List[str] = list(command or _DEFAULT_COMMAND)
        self._timeout = timeout

    async def setup(self) -> None:
        if self._runtime:
            await self._runtime.start()

    async def shutdown(self) -> None:
        if self._runtime:
            await self._runtime.shutdown()

    async def invoke(self, request: HarnessRequest) -> HarnessResult:
        payload = _rivet_payload(request, self._harness, self._sandbox)
        if self._base_url:
            return await self._invoke_http(payload)
        return await self._invoke_subprocess(payload)

    async def _invoke_http(self, payload: dict) -> HarnessResult:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f"{self._base_url}/run", json=payload)
        if response.status_code >= 500:
            raise RuntimeError(
                f"Rivet wrapper HTTP {response.status_code}: {response.text[:1000]}"
            )
        return _to_result(response.json())

    async def _invoke_subprocess(self, payload: dict) -> HarnessResult:
        assert self._runtime is not None
        result = await self._runtime.exec(
            self._command,
            json.dumps(payload).encode("utf-8"),
            cwd=self._wrapper_dir,
            env={**os.environ, "AGENT_BACKEND": "rivet"},
            timeout=self._timeout,
        )
        if not result.stdout.strip():
            raise RuntimeError(
                "Rivet wrapper returned no output. "
                f"exit={result.code} stderr={result.stderr[-2000:]}"
            )
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "Rivet wrapper returned invalid JSON. "
                f"stdout={result.stdout[:500]} stderr={result.stderr[-1000:]}"
            ) from exc
        return _to_result(data)
