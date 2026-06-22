"""InProcessPiBackend: drive Pi in-process through the TS runner, no sandbox-agent daemon.

This was the first backend implementation and stays as the simplest one: a single harness
(Pi), a single place (local), the legacy in-process Pi engine (``engines/pi.ts``). It is the
reference to read when writing a new backend.

It is its own class and hard-codes its differences (the ``pi`` engine, Pi-only support,
local-only). It is deliberately NOT a subclass of ``SandboxAgentBackend``; the two are different
engines that happen to share the ``utils`` wire and transport helpers.
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Dict, List, Mapping, Optional, Sequence

from ..dtos import (
    AgentResult,
    EventSink,
    HarnessAgentConfig,
    HarnessType,
    Message,
    TraceContext,
)
from ..interfaces import Backend, Sandbox, Session
from ..streaming import AgentRun
from ..utils import (
    deliver_http,
    deliver_http_stream,
    deliver_subprocess,
    deliver_subprocess_stream,
    request_to_wire,
    result_from_wire,
)
from ._runner_config import resolve_runner_command


class InProcessSandbox(Sandbox):
    """The local host. In-process Pi runs here directly; provisioning files are buffered
    (AGENTS.md rides the wire today)."""

    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        self.files.update(files)


class InProcessPiSession(Session):
    """One turn-per-prompt Pi session driven in-process by the TS runner."""

    def __init__(
        self,
        backend: "InProcessPiBackend",
        config: HarnessAgentConfig,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]],
        trace: Optional[TraceContext],
        session_id: Optional[str],
    ) -> None:
        self._backend = backend
        self._config = config
        self._harness = harness
        self._secrets = dict(secrets or {})
        self._trace = trace
        self._session_id = session_id

    @property
    def id(self) -> Optional[str]:
        return self._session_id

    def _wire_payload(self, messages: Sequence[Message]) -> Dict[str, Any]:
        """The ``/run`` request JSON for this turn (shared by ``prompt`` and ``stream``)."""
        return request_to_wire(
            engine=InProcessPiBackend._ENGINE,
            harness=self._harness,
            sandbox="local",
            config=self._config,
            messages=messages,
            secrets=self._secrets,
            trace=self._trace,
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
        data = await self._backend._deliver(self._wire_payload(messages))
        result = result_from_wire(data)
        self._absorb_result(result)
        if on_event:
            for event in result.events:
                try:
                    on_event(event)
                except Exception:  # pylint: disable=broad-except
                    pass
        return result

    def stream(self, messages: Sequence[Message]) -> AgentRun:
        """Run one turn over the streaming transport, yielding events live (see AgentRun)."""
        records = self._backend._deliver_stream(self._wire_payload(messages))
        return AgentRun(records).on_result(self._absorb_result)


class InProcessPiBackend(Backend):
    """The in-process Pi engine: drives the Pi SDK directly in the TS runner. Pi only, local
    only, no sandbox-agent daemon."""

    # Agenta is Pi with an opinion: same in-process engine, so this backend drives it too.
    supported_harnesses = frozenset({HarnessType.PI, HarnessType.AGENTA})
    _ENGINE = "pi"  # hard-coded engine identity

    def __init__(
        self,
        *,
        url: Optional[str] = None,
        command: Optional[Sequence[str]] = None,
        cwd: Optional[str] = None,
        timeout: float = float(os.getenv("AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS", "180")),
    ) -> None:
        self._url = url
        self._command: List[str] = resolve_runner_command(
            backend_name=type(self).__name__,
            url=url,
            command=command,
            cwd=cwd,
        )
        self._cwd = cwd
        self._timeout = timeout

    async def create_sandbox(self) -> InProcessSandbox:
        return InProcessSandbox()

    async def create_session(
        self,
        sandbox: Sandbox,
        config: HarnessAgentConfig,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]] = None,
        trace: Optional[TraceContext] = None,
        session_id: Optional[str] = None,
    ) -> InProcessPiSession:
        return InProcessPiSession(
            self,
            config,
            harness=harness,
            secrets=secrets,
            trace=trace,
            session_id=session_id,
        )

    async def _deliver(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self._url:
            return await deliver_http(self._url, payload, timeout=self._timeout)
        env = {**os.environ, "AGENT_BACKEND": self._ENGINE}
        return await deliver_subprocess(
            self._command, payload, cwd=self._cwd, env=env, timeout=self._timeout
        )

    def _deliver_stream(self, payload: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        """The live counterpart of ``_deliver``: an NDJSON record stream from the runner."""
        if self._url:
            return deliver_http_stream(self._url, payload, timeout=self._timeout)
        env = {**os.environ, "AGENT_BACKEND": self._ENGINE}
        return deliver_subprocess_stream(
            self._command, payload, cwd=self._cwd, env=env, timeout=self._timeout
        )
