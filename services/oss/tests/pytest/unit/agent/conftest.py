"""Fakes for the agent service unit tests.

A local, minimal ``FakeBackend`` (≈ the SDK's) so the ``/invoke`` handler can run end-to-end
in-process with no runner, no LLM, and no network. It implements the real ``Backend`` /
``Sandbox`` / ``Session`` ports, so the port contract keeps it honest across the two suites.

This conftest is scoped to ``unit/agent/`` so the handler tests do not pull the acceptance
suite's account / live-API fixtures from the services root conftest.
"""

from __future__ import annotations

from typing import Dict, Mapping, Optional, Sequence

import pytest

from agenta.sdk.agents import AgentResult, HarnessType
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentRun


class _FakeSandbox(Sandbox):
    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}
        self.destroyed = False

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        self.files.update(files)

    async def destroy(self) -> None:
        self.destroyed = True


class _FakeSession(Session):
    def __init__(self, result: AgentResult) -> None:
        self._result = result
        self.destroyed = False

    @property
    def id(self) -> Optional[str]:
        return self._result.session_id

    async def prompt(self, messages, *, on_event=None) -> AgentResult:
        return self._result

    def stream(self, messages) -> AgentRun:
        result = self._result

        async def _records():
            yield {
                "kind": "result",
                "result": {"ok": True, "output": result.output},
            }

        return AgentRun(_records())

    async def destroy(self) -> None:
        self.destroyed = True


class FakeBackend(Backend):
    """Echoes a fixed result, regardless of harness. Records lifecycle for assertions.

    Crucially it also records the *harness-shaped* config each ``create_session`` receives
    (the ``PiAgentConfig`` / ``ClaudeAgentConfig`` / ``AgentaAgentConfig`` the harness
    produced). This is the backend boundary where per-harness translation surfaces, so a
    handler test can assert the response body is identical across harnesses *and* that the
    translated configs diverge as designed (Pi keeps built-ins and forces auto; Claude drops
    built-ins and honors the policy; Agenta unions forced tools and carries skills).
    """

    def __init__(
        self,
        *,
        result: Optional[AgentResult] = None,
        supported: Sequence[HarnessType] = (
            HarnessType.PI,
            HarnessType.CLAUDE,
            HarnessType.AGENTA,
        ),
    ) -> None:
        self.supported_harnesses = frozenset(supported)
        self._result = result if result is not None else AgentResult(output="echo")
        self.setup_calls = 0
        self.shutdown_calls = 0
        # Every harness-shaped config that reached the backend boundary, in call order.
        self.created_configs: list = []
        self.created_session_ids: list[Optional[str]] = []
        # The injected provider env (``session_config.secrets``) per session, in call order.
        # This is the credential channel; a Slice 3 test asserts exactly one connection's env
        # reaches the boundary (or nothing, for a runtime_provided / unconfigured run).
        self.created_secrets: list[Optional[Mapping[str, str]]] = []
        # The run context threaded into each session (direct-call tools, Phase 3a), in call order,
        # so a test can assert the service-side run-context population reaches the boundary.
        self.created_run_contexts: list = []

    async def setup(self) -> None:
        self.setup_calls += 1

    async def shutdown(self) -> None:
        self.shutdown_calls += 1

    async def create_sandbox(self) -> _FakeSandbox:
        return _FakeSandbox()

    async def create_session(
        self,
        sandbox,
        config,
        *,
        harness,
        secrets=None,
        trace=None,
        run_context=None,
        session_id=None,
    ) -> _FakeSession:
        self.created_configs.append(config)
        self.created_session_ids.append(session_id)
        self.created_secrets.append(secrets)
        self.created_run_contexts.append(run_context)
        return _FakeSession(self._result)


@pytest.fixture
def fake_backend():
    def _make(**kwargs) -> FakeBackend:
        return FakeBackend(**kwargs)

    return _make
