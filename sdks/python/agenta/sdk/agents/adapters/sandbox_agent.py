"""SandboxAgentBackend: drive a harness over ACP via the TypeScript sandbox-agent runner.

This backend hard-codes that it is the sandbox-agent engine. It reaches the same runner the deployed
sidecar runs (HTTP when a ``url`` is set, otherwise a subprocess CLI), and the runner starts
the sandbox-agent daemon, the ACP adapter, and the harness. Supports Pi, Claude, and Agenta (Pi with
an opinion, which the runner drives on the same ``pi`` ACP agent plus forced skills). The
``sandbox`` axis (``local`` / ``daytona``) is a real runtime choice, so it stays a constructor
arg.

It is its own class, not a subclass of any other backend; it shares only the ``utils`` wire
and transport helpers.
"""

from __future__ import annotations

import logging
import os
from typing import Any, AsyncIterator, Dict, List, Mapping, Optional, Sequence

from ..dtos import (
    AgentResult,
    EventSink,
    HarnessAgentTemplate,
    HarnessType,
    Message,
    RunContext,
    TraceContext,
)
from ..interfaces import Backend, Sandbox, Session
from ..streaming import AgentStream
from ..utils import (
    deliver_http_result,
    deliver_http_stream,
    deliver_subprocess_result,
    deliver_subprocess_stream,
    request_to_wire,
    result_from_wire,
)
from ._runner_config import resolve_runner_command

_log = logging.getLogger(__name__)


class SandboxAgentSandbox(Sandbox):
    """Carries the sandbox axis for the run. The real sandbox (a local daemon or a Daytona
    VM) is created inside the TS runner; here we hold the axis and buffer provisioning files
    (today AGENTS.md rides the wire, so this is informational)."""

    def __init__(self, sandbox_id: str) -> None:
        self.sandbox_id = sandbox_id
        self.files: Dict[str, bytes] = {}

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        self.files.update(files)


class SandboxAgentSession(Session):
    """One turn-per-prompt session. Each prompt sends one ``/run`` (cold + replay)."""

    def __init__(
        self,
        backend: "SandboxAgentBackend",
        sandbox: SandboxAgentSandbox,
        config: HarnessAgentTemplate,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]],
        trace: Optional[TraceContext],
        run_context: Optional[RunContext],
        session_id: Optional[str],
    ) -> None:
        self._backend = backend
        self._sandbox = sandbox
        self._config = config
        self._harness = harness
        self._secrets = dict(secrets or {})
        self._trace = trace
        self._run_context = run_context
        self._session_id = session_id

    @property
    def id(self) -> Optional[str]:
        return self._session_id

    def _wire_payload(self, messages: Sequence[Message]) -> Dict[str, Any]:
        """The ``/run`` request JSON for this turn (shared by ``prompt`` and ``stream``)."""
        return request_to_wire(
            harness=self._harness,
            sandbox=self._sandbox.sandbox_id,
            config=self._config,
            messages=messages,
            secrets=self._secrets,
            trace=self._trace,
            run_context=self._run_context,
            session_id=self._session_id,
        )

    def _absorb_result(self, result: AgentResult) -> None:
        """Carry the run's session id forward so a follow-up turn resumes it."""
        if result.session_id:
            self._session_id = result.session_id

    async def prompt(
        self,
        messages: Sequence[Message],
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        # DEV-ONLY (unused). The agent runs over `stream()`; the normalizer coalesces the batch
        # result from the drained stream. Kept for local debugging of the one-shot /run path.
        data = await self._backend._deliver_result(self._wire_payload(messages))
        result = result_from_wire(data)
        self._absorb_result(result)
        _emit_events(result, on_event)
        return result

    def stream(self, messages: Sequence[Message]) -> AgentStream:
        """Run one turn over the streaming transport, yielding events live (see AgentStream)."""
        records = self._backend._deliver_stream(self._wire_payload(messages))
        return AgentStream(records).on_result(self._absorb_result)


class SandboxAgentBackend(Backend):
    """The sandbox-agent engine: a harness over ACP through the TS runner. Pi, Claude, Agenta, OpenCode."""

    supported_harnesses = frozenset(
        {HarnessType.PI, HarnessType.CLAUDE, HarnessType.AGENTA, HarnessType.OPENCODE}
    )

    def __init__(
        self,
        *,
        sandbox: str = "local",
        url: Optional[str] = None,
        command: Optional[Sequence[str]] = None,
        cwd: Optional[str] = None,
        timeout: float = float(os.getenv("AGENTA_RUNNER_TIMEOUT_SECONDS", "180")),
    ) -> None:
        self._sandbox = sandbox
        self._url = url
        self._command: List[str] = resolve_runner_command(
            backend_name=type(self).__name__,
            url=url,
            command=command,
            cwd=cwd,
        )
        self._cwd = cwd
        self._timeout = timeout

    async def create_sandbox(self) -> SandboxAgentSandbox:
        return SandboxAgentSandbox(self._sandbox)

    async def create_session(
        self,
        sandbox: Sandbox,
        config: HarnessAgentTemplate,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]] = None,
        trace: Optional[TraceContext] = None,
        run_context: Optional[RunContext] = None,
        session_id: Optional[str] = None,
    ) -> SandboxAgentSession:
        if not isinstance(sandbox, SandboxAgentSandbox):
            raise TypeError(
                "SandboxAgentBackend.create_session requires a SandboxAgentSandbox"
            )
        return SandboxAgentSession(
            self,
            sandbox,
            config,
            harness=harness,
            secrets=secrets,
            trace=trace,
            run_context=run_context,
            session_id=session_id,
        )

    async def _deliver_result(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        # DEV-ONLY (unused): the one-shot result transport. The agent path uses _deliver_stream.
        if self._url:
            return await deliver_http_result(self._url, payload, timeout=self._timeout)
        return await deliver_subprocess_result(
            self._command, payload, cwd=self._cwd, timeout=self._timeout
        )

    def _deliver_stream(self, payload: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        """The live counterpart of ``_deliver_result``: an NDJSON record stream from the runner."""
        if self._url:
            return deliver_http_stream(self._url, payload, timeout=self._timeout)
        return deliver_subprocess_stream(
            self._command, payload, cwd=self._cwd, timeout=self._timeout
        )


def _emit_events(result: AgentResult, on_event: Optional[EventSink]) -> None:
    """Replay the result's event log to a live sink (the one-shot transports batch it)."""
    if not on_event:
        return
    for event in result.events:
        try:
            on_event(event)
        except Exception:  # pylint: disable=broad-except
            # The sink is caller-provided; don't let it crash the result. Log at debug so a
            # misbehaving sink is still diagnosable.
            _log.debug("event sink raised; suppressing", exc_info=True)
