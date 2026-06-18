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
    """Echoes a fixed result, regardless of harness. Records lifecycle for assertions."""

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

    async def setup(self) -> None:
        self.setup_calls += 1

    async def shutdown(self) -> None:
        self.shutdown_calls += 1

    async def create_sandbox(self) -> _FakeSandbox:
        return _FakeSandbox()

    async def create_session(
        self, sandbox, config, *, harness, secrets=None, trace=None, session_id=None
    ) -> _FakeSession:
        return _FakeSession(self._result)


@pytest.fixture
def fake_backend():
    def _make(**kwargs) -> FakeBackend:
        return FakeBackend(**kwargs)

    return _make
