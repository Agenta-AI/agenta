"""Run-kind plumbing for reserved platform handler recursion protection."""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentResult,
    AgentTemplate,
    ResolvedConnection,
    ResolvedToolSet,
    RunContext,
    RunContextTrace,
)
from agenta.sdk.models.workflows import WorkflowServiceRequest

from oss.src.agent import app


def _patch_agent(monkeypatch, backend, *, base_run_context=None):
    async def _tools(tools, **_kw):
        return ResolvedToolSet()

    async def _no_mcp(mcp_servers, **_kw):
        return []

    async def _no_connection(*, model, context):
        return ResolvedConnection(
            provider="openai",
            model="m",
            credential_mode="runtime_provided",
            env={},
        )

    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", _no_connection)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(app, "run_context", lambda: base_run_context)
    monkeypatch.setattr(app, "record_usage", lambda usage: None)
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(instructions="x", model="m"),
    )


async def _invoke(meta=None):
    return await app._agent(
        request=WorkflowServiceRequest(meta=meta),
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": {"kind": "pi_core"}}},
    )


async def test_meta_run_kind_reaches_run_context(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="ok"))
    _patch_agent(monkeypatch, backend)

    await _invoke(meta={"run_kind": "test"})

    ctx = backend.created_run_contexts[0]
    assert ctx is not None
    assert ctx.to_wire() == {"run": {"kind": "test"}}


async def test_absent_run_kind_leaves_run_context_unchanged(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="ok"))
    base = RunContext(trace=RunContextTrace(trace_id="trace-1"))
    _patch_agent(monkeypatch, backend, base_run_context=base)

    await _invoke(meta={})

    ctx = backend.created_run_contexts[0]
    assert ctx is base
    assert ctx.to_wire() == {"trace": {"trace_id": "trace-1"}}
