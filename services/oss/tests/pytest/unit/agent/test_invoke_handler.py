"""The ``/invoke`` handler (`_agent`) end-to-end in-process.

Runs the real parse -> resolve -> harness -> record path with a ``FakeBackend`` and the
network-touching helpers stubbed. No runner, no LLM, no HTTP. This is where the cross-harness
"byte-identical response body" guarantee is locked at the Python layer.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import AgentConfig, AgentResult

from oss.src.agent import app


@pytest.fixture
def patched(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 15}))
    recorded = {}

    async def _no_tools(_tools):
        return [], [], None

    async def _no_secrets():
        return {}

    monkeypatch.setattr(app, "resolve_tools", _no_tools)
    monkeypatch.setattr(app, "resolve_harness_secrets", _no_secrets)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(
        app, "record_usage", lambda usage: recorded.__setitem__("usage", usage)
    )
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app, "_default_agent_config", lambda: AgentConfig(instructions="x", model="m")
    )
    return backend, recorded


async def _invoke(harness="pi"):
    return await app._agent(
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": harness}},
    )


async def test_invoke_returns_assistant_message(patched):
    assert await _invoke("pi") == {"role": "assistant", "content": "echo"}


async def test_invoke_records_usage(patched):
    _, recorded = patched
    await _invoke("pi")
    assert recorded["usage"] == {"total": 15}


async def test_invoke_runs_backend_lifecycle(patched):
    backend, _ = patched
    await _invoke("pi")
    assert backend.setup_calls == 1
    assert backend.shutdown_calls == 1  # cleanup() tears the backend down


async def test_invoke_body_is_identical_across_harnesses(patched):
    # The same turn against the same (echoing) backend must produce a byte-identical body
    # whether routed as pi, agenta, or claude. This is the design's cross-harness guarantee.
    pi = await _invoke("pi")
    agenta = await _invoke("agenta")
    claude = await _invoke("claude")
    assert pi == agenta == claude
