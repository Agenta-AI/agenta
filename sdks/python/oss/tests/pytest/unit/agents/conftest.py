"""Shared fakes and fixtures for the agent-runtime unit tests.

The fakes implement the real ports (``Backend`` / ``Sandbox`` / ``Session`` from
``agenta.sdk.agents.interfaces``) so the port contract keeps them honest: if a port grows an
abstract method, the fake fails to instantiate and these tests flag that the fake needs
updating. They record what they receive so a test can assert on lifecycle and translation
without a runner, a sandbox, an LLM, or the network.

Everything is exposed through fixtures because pytest's prepend import mode makes a plain
``from .fakes import ...`` brittle across components; a fixture factory sidesteps that.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence

import pytest

from agenta.sdk.agents import (
    AgentResult,
    Environment,
    HarnessKind,
)
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentStream


class FakeSandbox(Sandbox):
    """Records provisioning and teardown."""

    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}
        self.destroyed = False

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        self.files.update(files)

    async def destroy(self) -> None:
        self.destroyed = True


class FakeSession(Session):
    """Returns a canned result, records prompts, and tracks teardown. Can be told to raise."""

    def __init__(
        self,
        *,
        result: AgentResult,
        session_id: Optional[str] = None,
        raise_on_prompt: bool = False,
    ) -> None:
        self._result = result
        self._session_id = session_id
        self._raise = raise_on_prompt
        self.prompts: List[List[Any]] = []
        self.destroyed = False

    @property
    def id(self) -> Optional[str]:
        return self._session_id

    async def prompt(self, messages, *, on_event=None) -> AgentResult:
        self.prompts.append(list(messages))
        if self._raise:
            raise RuntimeError("boom from fake session")
        if on_event:
            for event in self._result.events:
                on_event(event)
        return self._result

    def stream(self, messages) -> AgentStream:
        # Mirror the runner's NDJSON stream: an event record per event, then one terminal
        # result record (the shape `result_from_wire`/`AgentStream` expect).
        self.prompts.append(list(messages))
        result = self._result
        raising = self._raise

        async def _records():
            if raising:
                yield {
                    "kind": "result",
                    "result": {"ok": False, "error": "boom from fake session"},
                }
                return
            for event in result.events:
                yield {"kind": "event", "event": event.data}
            terminal = {
                "ok": True,
                "output": result.output,
                "usage": result.usage,
                "sessionId": result.session_id,
            }
            if result.stop_reason is not None:
                terminal["stopReason"] = result.stop_reason
            yield {"kind": "result", "result": terminal}

        return AgentStream(_records())

    async def destroy(self) -> None:
        self.destroyed = True


class FakeBackend(Backend):
    """A backend that hands out fakes and records every lifecycle call."""

    def __init__(
        self,
        *,
        supported: Sequence[HarnessKind] = (HarnessKind.PI, HarnessKind.CLAUDE),
        result: Optional[AgentResult] = None,
        result_session_id: Optional[str] = None,
        raise_on_prompt: bool = False,
    ) -> None:
        # Instance attribute shadows the ClassVar so `supports()` reflects this fake.
        self.supported_harnesses = frozenset(supported)
        self._result = result if result is not None else AgentResult(output="ok")
        self._result_session_id = result_session_id
        self._raise = raise_on_prompt
        self.sandboxes: List[FakeSandbox] = []
        self.sessions: List[FakeSession] = []
        self.created_sessions: List[Dict[str, Any]] = []
        self.setup_calls = 0
        self.shutdown_calls = 0

    async def setup(self) -> None:
        self.setup_calls += 1

    async def shutdown(self) -> None:
        self.shutdown_calls += 1

    async def create_sandbox(self) -> FakeSandbox:
        sandbox = FakeSandbox()
        self.sandboxes.append(sandbox)
        return sandbox

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
    ) -> FakeSession:
        self.created_sessions.append(
            {
                "sandbox": sandbox,
                "config": config,
                "harness": harness,
                "secrets": secrets,
                "trace": trace,
                "run_context": run_context,
                "session_id": session_id,
            }
        )
        session = FakeSession(
            result=self._result,
            session_id=self._result_session_id,
            raise_on_prompt=self._raise,
        )
        self.sessions.append(session)
        return session


@pytest.fixture
def make_backend():
    """Factory returning a configured :class:`FakeBackend`."""

    def _make(**kwargs) -> FakeBackend:
        return FakeBackend(**kwargs)

    return _make


@pytest.fixture
def make_env(make_backend):
    """Factory returning an :class:`Environment` over a fresh :class:`FakeBackend`.

    Returns the Environment; reach its backend via ``env.backend`` to assert on recordings.
    """

    def _make(*, sandbox_per_session: bool = True, **backend_kwargs) -> Environment:
        backend = make_backend(**backend_kwargs)
        return Environment(backend, sandbox_per_session=sandbox_per_session)

    return _make


@pytest.fixture
def golden():
    """Load a checked-in golden ``/run`` fixture (the cross-language wire contract anchor)."""
    base = Path(__file__).parent / "golden"

    def _load(name: str) -> Dict[str, Any]:
        return json.loads((base / name).read_text(encoding="utf-8"))

    return _load
