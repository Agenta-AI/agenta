"""Unit tests for the SDK's ambient tracing capture (`agenta.sdk.agents.tracing`).

Covers `run_context()`'s independent-failure-domain contract: the workflow identity and the trace
identity are captured separately, so a failure reading one must not drop the other.
"""

from __future__ import annotations

from types import SimpleNamespace

from agenta.sdk.agents import (
    RunContextProject,
    RunContextTrace,
    RunContextWorkflow,
)

from agenta.sdk.agents import tracing


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


def test_run_context_none_when_all_empty(monkeypatch):
    # No project, no workflow identity, and no trace -> no run context at all (the key is omitted
    # on the wire).
    monkeypatch.setattr(tracing, "_run_context_project", lambda: None)
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


def test_run_context_project_stamped_from_server_baggage(monkeypatch):
    # The owning project id is read from the SERVER-derived request context (the authenticated
    # OTel baggage on TracingContext), never from anything the caller sends. This is the source
    # the runner trusts to scope its keep-alive pool.
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(baggage={"project_id": "proj-42"}),
    )

    project = tracing._run_context_project()

    assert project == RunContextProject(id="proj-42")


def test_run_context_project_none_without_baggage(monkeypatch):
    # No baggage / no project_id in the request state -> no project scope; the field is omitted
    # and the runner falls back to the mount-derived scope.
    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(baggage=None),
    )
    assert tracing._run_context_project() is None

    monkeypatch.setattr(
        tracing.TracingContext,
        "get",
        lambda: SimpleNamespace(baggage={"other": "x"}),
    )
    assert tracing._run_context_project() is None


def test_run_context_keeps_project_when_workflow_and_trace_fail(monkeypatch):
    # The project scope is its own failure domain: a run that holds only a project id (no workflow,
    # no trace) still ships `runContext.project` so the runner can key its keep-alive pool on it.
    def boom():
        raise RuntimeError("unavailable")

    monkeypatch.setattr(
        tracing,
        "_run_context_project",
        lambda: RunContextProject(id="proj-42"),
    )
    monkeypatch.setattr(tracing, "_run_context_workflow", boom)
    monkeypatch.setattr(tracing, "_run_context_trace", boom)

    ctx = tracing.run_context()
    assert ctx is not None
    assert ctx.project == RunContextProject(id="proj-42")
    assert ctx.workflow is None
    assert ctx.trace is None
    # The project rides the wire under the snake_case `project.id` binding namespace.
    assert ctx.to_wire() == {"project": {"id": "proj-42"}}
