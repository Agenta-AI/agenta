"""Unit tests for the agent service's tracing glue (`oss.src.agent.tracing`).

Covers `run_context()`'s independent-failure-domain contract: the workflow identity and the trace
identity are captured separately, so a failure reading one must not drop the other.
"""

from __future__ import annotations

from agenta.sdk.agents import RunContextTrace, RunContextWorkflow

from oss.src.agent import tracing


def test_run_context_keeps_trace_when_workflow_capture_fails(monkeypatch):
    # A failure reading the workflow references must not drop an otherwise-valid trace: a
    # trace-only run still ships `runContext.trace`.
    def boom():
        raise RuntimeError("tracing references unavailable")

    monkeypatch.setattr(tracing, "_run_context_workflow", boom)
    monkeypatch.setattr(
        tracing,
        "_run_context_trace",
        lambda: RunContextTrace(trace_id="t", span_id="s"),
    )

    ctx = tracing.run_context()
    assert ctx is not None
    assert ctx.workflow is None
    assert ctx.trace == RunContextTrace(trace_id="t", span_id="s")


def test_run_context_keeps_workflow_when_trace_capture_fails(monkeypatch):
    # The reverse domain: a failure reading the active span must not drop a valid workflow identity.
    def boom():
        raise RuntimeError("span context unavailable")

    monkeypatch.setattr(
        tracing,
        "_run_context_workflow",
        lambda: RunContextWorkflow(is_draft=True),
    )
    monkeypatch.setattr(tracing, "_run_context_trace", boom)

    ctx = tracing.run_context()
    assert ctx is not None
    assert ctx.trace is None
    assert ctx.workflow == RunContextWorkflow(is_draft=True)


def test_run_context_none_when_both_empty(monkeypatch):
    # No workflow identity and no trace -> no run context at all (the key is omitted on the wire).
    monkeypatch.setattr(tracing, "_run_context_workflow", lambda: None)
    monkeypatch.setattr(tracing, "_run_context_trace", lambda: None)
    assert tracing.run_context() is None
