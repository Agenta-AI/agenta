"""Per-run redaction scoping in the agent handler.

The handler seeds each run's deny-set from that run's resolved credentials. The seed must go
into a FRESH `Redactor` installed for exactly the run's scope (batch call / stream lifetime)
and restored on exit — never mutated into a long-lived ambient redactor. Otherwise sequential
runs sharing one task/context accumulate each other's secret values: the second run's sinks
would hold (and its lifetime would extend) the first run's live credentials.

These tests drive `make_agent_handler` with the same fakes shape as
`test_agent_composition_seam.py` and observe the ambient redactor from inside the run (the
backend's `create_session` runs within the scope every sink shares).
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Dict, List, Optional

from agenta.sdk.agents import AgentResult, HarnessKind
from agenta.sdk.agents.connections import ResolvedConnection
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentStream
from agenta.sdk.models.workflows import WorkflowServiceRequest
from agenta.sdk.redaction.context import get_active_redactor
from agenta.sdk.redaction.redactor import Redactor

SECRET_A = "sk-run-a-fake-secret-aaaa1111aaaa1111"
SECRET_B = "sk-run-b-fake-secret-bbbb2222bbbb2222"


# --------------------------------------------------------------------------- #
# Fakes (mirrors test_agent_composition_seam.py's shape)
# --------------------------------------------------------------------------- #
class _FakeSandbox(Sandbox):
    async def add_files(self, files) -> None:
        return None

    async def destroy(self) -> None:
        return None


class _FakeSession(Session):
    def __init__(self, result: AgentResult) -> None:
        self._result = result

    @property
    def id(self) -> Optional[str]:
        return self._result.session_id

    async def prompt(self, messages, *, on_event=None) -> AgentResult:
        return self._result

    def stream(self, messages) -> AgentStream:
        result = self._result

        async def _records() -> AsyncIterator[Dict[str, Any]]:
            yield {
                "kind": "event",
                "event": {"type": "message", "text": result.output},
            }
            yield {
                "kind": "result",
                "result": {
                    "ok": True,
                    "output": result.output,
                    "usage": result.usage,
                    "sessionId": result.session_id,
                },
            }

        return AgentStream(_records())

    async def destroy(self) -> None:
        return None


class _CapturingBackend(Backend):
    """Records the AMBIENT redactor observed inside each run (at session creation time)."""

    supported_harnesses = frozenset({HarnessKind.PI, HarnessKind.CLAUDE})

    def __init__(self, *, output: str = "ok") -> None:
        self._output = output
        self.captured_redactors: List[Redactor] = []

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
        self.captured_redactors.append(get_active_redactor())
        return _FakeSession(AgentResult(output=self._output, events=[], usage={}))


def _make_handler(secret: str, backend: _CapturingBackend):
    async def _resolve(*, model, context):
        return ResolvedConnection(
            provider="openai",
            model="qwen2.5-coder:7b",
            deployment="custom",
            credential_mode="env",
            credentials=[
                {
                    "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                    "value": secret,
                    "usage": "opaque_http",
                }
            ],
            endpoint={"base_url": "https://93.184.216.34/v1"},
        )

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_resolve,
    )
    return make_agent_handler(comp)


def _params() -> Dict[str, Any]:
    return {
        "agent": {
            "harness": {"kind": "pi_core"},
            "llm": {"provider": "openai", "model": "qwen2.5-coder:7b"},
        }
    }


def _messages() -> List[Dict[str, str]]:
    return [{"role": "user", "content": "hi"}]


def _knows(redactor: Redactor, secret: str) -> bool:
    """True when `secret` is in the redactor's deny-set (it gets scrubbed)."""
    return secret not in (redactor.redact_string(f"x {secret}", sink="test") or "")


# --------------------------------------------------------------------------- #
# Sequential runs in ONE task/context: no accumulation, ambient restored
# --------------------------------------------------------------------------- #
async def test_sequential_batch_runs_do_not_accumulate_deny_set():
    backend = _CapturingBackend()
    baseline = get_active_redactor()  # the ambient redactor of this task, pre-run

    await _make_handler(SECRET_A, backend)(
        request=WorkflowServiceRequest(),
        messages=_messages(),
        parameters=_params(),
    )
    first = backend.captured_redactors[0]
    assert _knows(first, SECRET_A), "run 1's redactor is seeded with run 1's secret"
    # The run's scope closed: the ambient redactor is the pre-run one again, unseeded.
    assert get_active_redactor() is baseline
    assert not _knows(baseline, SECRET_A)

    await _make_handler(SECRET_B, backend)(
        request=WorkflowServiceRequest(),
        messages=_messages(),
        parameters=_params(),
    )
    second = backend.captured_redactors[1]
    assert second is not first, "each run gets a FRESH redactor"
    assert _knows(second, SECRET_B)
    # The core isolation property: run 2's deny-set does NOT hold run 1's secret.
    assert not _knows(second, SECRET_A)
    assert get_active_redactor() is baseline


async def test_sequential_streaming_runs_scope_and_restore():
    backend = _CapturingBackend(output=f"leak {SECRET_A}")
    baseline = get_active_redactor()

    stream = await _make_handler(SECRET_A, backend)(
        request=WorkflowServiceRequest(flags={"stream": True}),
        messages=_messages(),
        parameters=_params(),
    )
    events = [event async for event in stream]
    # The seeded scope was active during iteration: the echoed secret is scrubbed from the
    # live event wire.
    assert events, "the stream produced events"
    assert SECRET_A not in str(events)
    assert "[ag:redacted" in str(events)
    first = backend.captured_redactors[0]
    assert _knows(first, SECRET_A)
    # Exhausting the stream closed the scope: the ambient redactor is restored, unseeded.
    assert get_active_redactor() is baseline
    assert not _knows(baseline, SECRET_A)

    stream_b = await _make_handler(SECRET_B, backend)(
        request=WorkflowServiceRequest(flags={"stream": True}),
        messages=_messages(),
        parameters=_params(),
    )
    async for _ in stream_b:
        pass
    second = backend.captured_redactors[1]
    assert _knows(second, SECRET_B)
    assert not _knows(second, SECRET_A), "no accumulation across streamed runs"
    assert get_active_redactor() is baseline


# --------------------------------------------------------------------------- #
# Concurrent runs: each task's scope holds only its own secret
# --------------------------------------------------------------------------- #
async def test_concurrent_runs_have_isolated_deny_sets():
    backend_a = _CapturingBackend()
    backend_b = _CapturingBackend()

    await asyncio.gather(
        _make_handler(SECRET_A, backend_a)(
            request=WorkflowServiceRequest(),
            messages=_messages(),
            parameters=_params(),
        ),
        _make_handler(SECRET_B, backend_b)(
            request=WorkflowServiceRequest(),
            messages=_messages(),
            parameters=_params(),
        ),
    )

    run_a = backend_a.captured_redactors[0]
    run_b = backend_b.captured_redactors[0]
    assert _knows(run_a, SECRET_A) and not _knows(run_a, SECRET_B)
    assert _knows(run_b, SECRET_B) and not _knows(run_b, SECRET_A)
