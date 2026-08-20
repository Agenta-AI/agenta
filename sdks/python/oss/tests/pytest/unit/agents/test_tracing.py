"""Unit tests for the SDK's ambient tracing capture (`agenta.sdk.agents.tracing`).

Covers `run_context()`'s independent-failure-domain contract: the workflow identity and the trace
identity are captured separately, so a failure reading one must not drop the other.
"""

from __future__ import annotations

from types import SimpleNamespace

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


def test_trace_context_splits_general_and_export_credentials(monkeypatch):
    # THE REGRESSION TEST for the session-breaking blocker: the runner reads
    # `telemetry.exporters.otlp.headers.authorization` to authenticate ALL session-coordination
    # calls (ownership claims, mount signing, the turns ledger, history reconstruction,
    # working-copy restore, attachment resolution), not just span export. If a scoped
    # trace-ingest-only credential ever lands in that slot instead of `export_authorization`,
    # every one of those calls is rejected and agent sessions break end to end.
    monkeypatch.setattr(
        tracing,
        "inject",
        lambda _headers: {"Authorization": "Secret general-credential"},
    )
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(telemetry_credentials="Secret telemetry-credential"),
    )

    context = tracing.trace_context()

    assert context is not None
    assert context.authorization == "Secret general-credential"
    assert context.export_authorization == "Secret telemetry-credential"


def test_trace_context_falls_back_to_authorization_without_telemetry_credentials(
    monkeypatch,
):
    # Older platforms issue no telemetry credential; the runner falls back to
    # `headers.authorization` for the export request too, and the general credential is
    # unaffected either way.
    monkeypatch.setattr(
        tracing,
        "inject",
        lambda _headers: {"Authorization": "Secret general-credential"},
    )
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(telemetry_credentials=None),
    )

    context = tracing.trace_context()

    assert context is not None
    assert context.authorization == "Secret general-credential"
    assert context.export_authorization is None


def test_trace_context_keeps_telemetry_credentials_without_traceparent(monkeypatch):
    # A run holding only the telemetry credential (no traceparent, no general credential)
    # still yields a TraceContext so its spans can export.
    monkeypatch.setattr(tracing, "inject", lambda _headers: {})
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(telemetry_credentials="Secret telemetry-credential"),
    )

    context = tracing.trace_context()

    assert context is not None
    assert context.traceparent is None
    assert context.authorization is None
    assert context.export_authorization == "Secret telemetry-credential"


def test_trace_context_none_without_traceparent_or_authorization(monkeypatch):
    monkeypatch.setattr(tracing, "inject", lambda _headers: {})
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(telemetry_credentials=None),
    )

    assert tracing.trace_context() is None


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
