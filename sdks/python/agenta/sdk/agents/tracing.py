"""Ambient tracing capture: thread the active workflow trace into the run, record its usage.

These are the runtime defaults of the ``AgentComposition`` seam (see ``handler.py``). Each
reads ambient SDK-owned state at CALL time — the active OpenTelemetry span, the
``TracingContext`` ContextVar (traceparent, baggage, credentials, references) — and degrades
to ``None``/no-op when a run has no such state (the standalone case). The handler runs inside
the instrumented ``/invoke`` span, so threading its trace context into the harness makes the
agent's spans children of that span (same trace), and stamping the run's token/cost totals
onto it shows the run's usage even though the harness exports its span tree in a separate
OTLP batch.
"""

import os
from typing import Any, Dict, Optional

from opentelemetry import trace as otel_trace

from agenta.sdk.contexts.tracing import TracingContext
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.agents.dtos import (
    RunContext,
    RunContextReference,
    RunContextTrace,
    RunContextWorkflow,
    TraceContext,
)

log = get_module_logger(__name__)

# Declares which token contract a span's ``gen_ai.usage.input_tokens`` follows. ``False`` means
# EXCLUSIVE — uncached input only, with cache reads/writes counted beside it, which is what every
# harness aggregate reports. An ABSENT marker means the OpenTelemetry meaning (input already
# includes cached tokens), and ingest prices the two differently, so any span carrying an input
# count must declare its contract. Mirrors ``INPUT_TOKENS_INCLUDES_CACHE`` in the runner's
# ``services/runner/src/tracing/otel.ts``.
INPUT_TOKENS_INCLUDES_CACHE = "agenta.usage.input_tokens_includes_cache"

_CAPTURE_CONTENT = os.getenv(
    "AGENTA_AGENT_CONTENT_CAPTURE_ENABLED", "true"
).lower() not in (
    "0",
    "false",
    "no",
)


def trace_context() -> Optional[TraceContext]:
    """Capture the active workflow span's trace context for the harness.

    Threading the ``/invoke`` span's ``traceparent`` into the run makes the agent's spans
    children of that span, so the whole run shows up under the response's ``trace_id`` the
    way completion/chat nest their LLM spans. The caller's credential rides along (via
    ``inject``'s ``Authorization`` re-emit from ``TracingContext.credentials``) — the runner
    authenticates its session-coordination calls AS the caller with it. Best-effort: any
    failure returns ``None`` and the run is traced standalone (or not at all) using the
    runner's env config.
    """
    try:
        headers = inject({})

        traceparent = headers.get("traceparent")
        authorization = headers.get("Authorization")
        if not traceparent and not authorization:
            return None

        endpoint = None
        try:
            import agenta as ag  # deferred: this module loads during `agenta` init

            endpoint = ag.tracing.otlp_url
        except Exception:  # pylint: disable=broad-except
            endpoint = None

        return TraceContext(
            traceparent=traceparent,
            baggage=headers.get("baggage"),
            endpoint=endpoint,
            authorization=authorization,
            capture_content=_CAPTURE_CONTENT,
        )
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to capture trace context", exc_info=True)
        return None


def _reference_field(
    references: Optional[Dict[str, Any]], key: str, field: str
) -> Optional[str]:
    """Pull one field (``id`` / ``slug`` / ``version``) from a reference entry, or ``None``.

    The entry may be a :class:`Reference` model or a plain dict. Any value is stringified so the
    run-context blob carries plain strings (UUIDs become their hex form), which is what the
    ``$ctx.<key>`` binding deep-sets into a request body."""
    if not references:
        return None
    entry = references.get(key)
    if entry is None:
        return None
    value = (
        getattr(entry, field, None) if not isinstance(entry, dict) else entry.get(field)
    )
    return str(value) if value is not None else None


def _run_context_reference(
    references: Optional[Dict[str, Any]], key: str, *, with_version: bool = False
) -> Optional[RunContextReference]:
    """Build one ``{id, slug, version}`` reference for a workflow entity, or ``None`` when empty.

    ``with_version`` is set only for the revision; the artifact and the variant carry no version
    in the tracing references."""
    reference = RunContextReference(
        id=_reference_field(references, key, "id"),
        slug=_reference_field(references, key, "slug"),
        version=_reference_field(references, key, "version") if with_version else None,
    )
    if reference.model_dump(exclude_none=True):
        return reference
    return None


def _run_context_reference_from_any(
    references: Optional[Dict[str, Any]],
    keys: tuple[str, ...],
    *,
    with_version: bool = False,
) -> Optional[RunContextReference]:
    """Build one run-context reference from the first populated key in ``keys``.

    Playground application and evaluator invocations carry application/evaluator references, but
    platform tools bind workflow identity because applications and evaluators are workflow-backed.
    Normalize those reference families into the workflow-shaped run context so self-targeting
    platform tools can still bind their own variant server-side.
    """
    for key in keys:
        reference = _run_context_reference(references, key, with_version=with_version)
        if reference is not None:
            return reference
    return None


def _run_context_workflow() -> Optional[RunContextWorkflow]:
    """The running workflow identity, best-effort, from the resolved tracing references.

    The references land on the tracing context after the resolver hydrates a stored
    variant/environment reference. Native workflow invocations use ``workflow*`` keys. Playground
    application and evaluator invocations use ``application*`` / ``evaluator*`` keys, but those
    entities are workflow-backed, so they normalize into the same run-context shape. A playground
    run of an unsaved inline config carries no revision reference, so ``is_draft`` is ``True``; a
    run pinned to a stored revision is not a draft. A run with no workflow identity at all returns
    ``None`` and the binding simply has no value — every field is optional."""
    references = TracingContext.get().references
    revision = _run_context_reference_from_any(
        references,
        ("workflow_revision", "application_revision", "evaluator_revision"),
        with_version=True,
    )
    workflow = RunContextWorkflow(
        artifact=_run_context_reference_from_any(
            references, ("workflow", "application", "evaluator")
        ),
        variant=_run_context_reference_from_any(
            references,
            ("workflow_variant", "application_variant", "evaluator_variant"),
        ),
        revision=revision,
    )
    if not workflow.model_dump(exclude_none=True):
        return None
    # A run is a draft when it carries some workflow identity but no committed revision (the
    # playground inline-config case); a run pinned to a stored revision is not a draft.
    workflow.is_draft = revision is None
    return workflow


def _run_context_trace() -> Optional[RunContextTrace]:
    """The current run's own trace + span ids, read from the active OpenTelemetry span.

    These are the ids a self-targeting tool binds (``$ctx.trace.trace_id`` for "annotate my
    trace"). Best-effort: a missing/invalid span context returns ``None``."""
    span_context = otel_trace.get_current_span().get_span_context()
    if not span_context or not span_context.is_valid:
        return None
    return RunContextTrace(
        trace_id=otel_trace.format_trace_id(span_context.trace_id),
        span_id=otel_trace.format_span_id(span_context.span_id),
    )


def run_context() -> Optional[RunContext]:
    """Capture the run's own context for tool bindings and run-kind propagation.

    Assembles the run's own trace + workflow identity into a :class:`RunContext` the service sends
    on ``/run`` (refreshed per turn). The full ``runContext`` is consumed by direct-call
    ``call.context`` bindings, callRef ``contextBindings``, and ``run.kind`` forwarding at dispatch,
    server-side and hidden from the model (see ``projects/direct-call-tools/run-context.md``). The
    conversation id is not part of this blob; it rides the top-level ``sessionId`` field.
    Best-effort: any failure (or an entirely empty context) returns ``None`` so the run proceeds and
    the ``runContext`` key is simply omitted.

    The workflow and the trace are captured as INDEPENDENT failure domains: a failure reading the
    workflow references must not drop an otherwise-valid ``trace`` (and vice versa), so a trace-only
    run still ships ``runContext.trace``."""
    workflow = None
    try:
        workflow = _run_context_workflow()
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to capture run-context workflow", exc_info=True)
    trace = None
    try:
        trace = _run_context_trace()
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to capture run-context trace", exc_info=True)
    if workflow is None and trace is None:
        return None
    return RunContext(workflow=workflow, trace=trace)


def record_usage(
    usage: Optional[Dict[str, Any]],
    *,
    span: Optional[Any] = None,
) -> None:
    """Stamp the agent's token/cost totals onto the ``/invoke`` workflow span.

    The harness emits its own span tree (turns, LLM, tools) in a separate OTLP batch, so
    Agenta's per-batch cumulative roll-up cannot bridge the totals onto the workflow span.
    Setting ``gen_ai.usage.*`` here records them directly on that span (the root of its
    batch), so the trace shows the run's tokens and cost. Best-effort.

    ``span`` pins the workflow span captured where the run began. Prefer it: the write happens
    from the run's teardown, arbitrarily far from the frame that made the span current, and any
    task driving the stream in between carries only a COPY of that context — so the ambient span
    at write time is not reliably the workflow span, and a write to a non-recording one is
    silently discarded. Omitting it falls back to the ambient span for standalone callers.

    Tokens and cost are INDEPENDENT measurements. The runner keeps a cost it was billed even when
    it has no trustworthy token split (``mergePromptAndStreamUsage`` in the runner returns
    ``{input: 0, output: 0, total: 0, cost}`` for exactly that case), and dropping such a record
    would leave the workflow span with nothing: the harness ships its own spans in a separate OTLP
    batch, the roll-up runs per batch, and trace-focused analytics read root spans only.

    MISSING vs MEASURED ZERO. A cost is reported whenever the key carries a number, so a reported
    ``0.0`` (a free model, a fully cached turn) is stamped as a measurement and a record with no
    cost key stamps nothing. This is sound only because the producer can omit the key: the
    runner's ``AgentUsage.cost`` is optional and left off when the harness reported no cost. A
    token TOTAL of zero is the one value read as absence rather than measurement: it is the
    runner's sentinel for "no trustworthy split", and no model call spends zero tokens — so a
    zero total writes no token attributes at all, rather than asserting a run that consumed
    nothing. Within a reported split, a zero input or output is written as the 0 it is (a split
    can honestly be one-sided).

    INPUT TOKEN CONTRACT. Every input token count Agenta ingests must declare whether it already
    includes cached tokens, or pricing derives ordinary input by subtracting cache buckets from a
    count that never contained them. This record is the harness's aggregate, and both upstream
    schemas that produce it report cache counts BESIDE the input count rather than inside it (Pi's
    session ``tokens`` carries ``input``/``cacheRead``/``cacheWrite`` as siblings; ACP's ``Usage``
    carries ``inputTokens``/``cachedReadTokens``/``cachedWriteTokens`` as siblings). The aggregate
    is therefore exclusive, and this span declares ``False`` alongside the counts — the same
    declaration the runner stamps on the leaf span that carries these very numbers.
    """
    try:
        if not usage:
            return
        raw_total = usage.get("total")
        total_tokens = int(raw_total) if raw_total is not None else 0
        raw_cost = usage.get("cost")
        has_tokens = total_tokens > 0
        has_cost = raw_cost is not None
        if not has_tokens and not has_cost:
            return
        span = span if span is not None else otel_trace.get_current_span()
        if has_tokens:
            input_tokens = int(usage.get("input") or 0)
            output_tokens = int(usage.get("output") or 0)
            span.set_attribute(INPUT_TOKENS_INCLUDES_CACHE, False)
            span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
            span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
            span.set_attribute("gen_ai.usage.prompt_tokens", input_tokens)
            span.set_attribute("gen_ai.usage.completion_tokens", output_tokens)
            span.set_attribute("gen_ai.usage.total_tokens", total_tokens)
        if has_cost:
            span.set_attribute("gen_ai.usage.cost", float(raw_cost))
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to record usage on workflow span", exc_info=True)
