"""Unit tests for the SDK's ambient tracing capture (`agenta.sdk.agents.tracing`).

Covers `run_context()`'s independent-failure-domain contract: the workflow identity and the trace
identity are captured separately, so a failure reading one must not drop the other.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from agenta.sdk.agents import RunContextTrace, RunContextWorkflow

from agenta.sdk.agents import tracing


def test_trace_context_keeps_authorization_without_traceparent(monkeypatch):
    monkeypatch.setattr(
        tracing,
        "inject",
        lambda _headers: {"Authorization": "ApiKey invoke-credential"},
    )

    context = tracing.trace_context()

    assert context is not None
    assert context.traceparent is None
    assert context.authorization == "ApiKey invoke-credential"


def test_trace_context_none_without_traceparent_or_authorization(monkeypatch):
    monkeypatch.setattr(tracing, "inject", lambda _headers: {})

    assert tracing.trace_context() is None


def test_record_usage_stamps_runner_totals_on_active_workflow_span(monkeypatch):
    attributes = {}
    span = SimpleNamespace(
        set_attribute=lambda key, value: attributes.__setitem__(key, value)
    )
    monkeypatch.setattr(tracing.otel_trace, "get_current_span", lambda: span)

    tracing.record_usage({"input": 100, "output": 20, "total": 120, "cost": 0.0042})

    assert attributes == {
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 20,
        "gen_ai.usage.prompt_tokens": 100,
        "gen_ai.usage.completion_tokens": 20,
        "gen_ai.usage.total_tokens": 120,
        "gen_ai.usage.cost": 0.0042,
    }


def test_record_usage_derives_total_from_input_and_output(monkeypatch):
    attributes = {}
    span = SimpleNamespace(
        set_attribute=lambda key, value: attributes.__setitem__(key, value)
    )
    monkeypatch.setattr(tracing.otel_trace, "get_current_span", lambda: span)

    tracing.record_usage({"input": 100, "output": 20})

    assert attributes["gen_ai.usage.total_tokens"] == 120


@pytest.mark.parametrize("cost", [0.0, 0.0042])
def test_record_usage_keeps_cost_without_token_total(monkeypatch, cost):
    attributes = {}
    span = SimpleNamespace(
        set_attribute=lambda key, value: attributes.__setitem__(key, value)
    )
    monkeypatch.setattr(tracing.otel_trace, "get_current_span", lambda: span)

    tracing.record_usage({"cost": cost})

    assert attributes == {"gen_ai.usage.cost": cost}


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


def test_run_context_workflow_normalizes_application_references(monkeypatch):
    # Playground app runs carry application-family references. Platform tools still bind workflow
    # identity because applications are workflow-backed, so the context normalizes those keys.
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(
            references={
                "application": {"id": "app-id", "slug": "agent-app"},
                "application_variant": {"id": "variant-id", "slug": "default"},
                "application_revision": {
                    "id": "revision-id",
                    "slug": "default",
                    "version": "v2",
                },
            }
        ),
    )

    workflow = tracing._run_context_workflow()

    assert workflow is not None
    assert workflow.artifact.id == "app-id"
    assert workflow.variant.id == "variant-id"
    assert workflow.revision.id == "revision-id"
    assert workflow.revision.version == "v2"
    assert workflow.is_draft is False
