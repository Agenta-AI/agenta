"""Test-only backend: drive the real ``/run`` wire and subprocess transport against a fake
runner program.

This is NOT a deployment backend. The service always uses ``SandboxAgentBackend``. This class
lives here, beside the transport round-trip test, only to exercise the real wire
(``request_to_wire`` / ``result_from_wire``) and the subprocess transport against a fake runner
script, with no TS, no daemon, and no LLM. It mirrors ``SandboxAgentBackend``'s wire path so the
serialization it covers is the one production uses.
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Dict, List, Mapping, Optional, Sequence

from agenta.sdk.agents.dtos import (
    AgentResult,
    EventSink,
    HarnessAgentConfig,
    HarnessType,
    Message,
    TraceContext,
)
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentRun
from agenta.sdk.agents.utils import (
    deliver_http,
    deliver_http_stream,
    deliver_subprocess,
    deliver_subprocess_stream,
    request_to_wire,
    result_from_wire,
)
from agenta.sdk.agents.adapters._runner_config import resolve_runner_command


class FakeRunnerSandbox(Sandbox):
    """A local stand-in sandbox; provisioning files are buffered (AGENTS.md rides the wire)."""

    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        self.files.update(files)


class FakeRunnerSession(Session):
    """One turn-per-prompt session driven through the wire + transport by a fake runner."""

    def __init__(
        self,
        backend: "FakeRunnerBackend",
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


class FakeRunnerBackend(Backend):
    """Drives the real wire + subprocess transport against a fake runner script. Test-only.

    It mirrors ``SandboxAgentBackend``'s wire path (no engine selector on the wire; the runner
    is one engine), so the serialization round-trip it covers is the one production uses.
    """

    supported_harnesses = frozenset(
        {HarnessType.PI, HarnessType.CLAUDE, HarnessType.AGENTA}
    )

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

    async def create_sandbox(self) -> FakeRunnerSandbox:
        return FakeRunnerSandbox()

    async def create_session(
        self,
        sandbox: Sandbox,
        config: HarnessAgentConfig,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]] = None,
        trace: Optional[TraceContext] = None,
        session_id: Optional[str] = None,
    ) -> FakeRunnerSession:
        return FakeRunnerSession(
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
        return await deliver_subprocess(
            self._command, payload, cwd=self._cwd, timeout=self._timeout
        )

    def _deliver_stream(self, payload: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        """The live counterpart of ``_deliver``: an NDJSON record stream from the runner."""
        if self._url:
            return deliver_http_stream(self._url, payload, timeout=self._timeout)
        return deliver_subprocess_stream(
            self._command, payload, cwd=self._cwd, timeout=self._timeout
        )
