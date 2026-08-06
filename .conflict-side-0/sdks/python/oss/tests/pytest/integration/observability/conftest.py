"""
In-memory OTel wiring for the PROGRAMMATIC (running + auto-instrument) trace tests.

The four shape tests assert on the spans an `@ag.workflow()` actually emits — span
tree (name/parent/kind/status) and content (`ag.*` attributes) — WITHOUT a backend.

How: the SDK marshals attributes into their final flat `ag.<ns>.<key>` form inside
`CustomSpan.set_attributes` (sdk/engines/tracing/spans.py → serialize()), i.e. BEFORE
the span is exported. So a plain in-memory exporter captures spans whose `.attributes`
already match what OTLP would ship and what the traces API stores. No OTLP endpoint,
no tracing worker, no `fetch_trace` polling.

`ag.tracer` / `ag.tracing` are the two globals the instrument decorator reads; the
fixture points both at a fresh in-memory provider per test (and restores them after),
so spans never bleed across tests under xdist.
"""

import pytest

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.sdk.resources import Resource

import agenta as ag
from agenta.sdk.engines.tracing.tracing import Tracing


class InMemoryTracing:
    """A real `Tracing` whose only span processor exports to memory.

    Mirrors `Tracing.configure()` but swaps the OTLP exporter for an in-memory
    one. Keeps the SAME tracer-provider/tracer surface the SDK uses, so the
    instrument decorator behaves identically — only the sink changes.
    """

    def __init__(self):
        self.exporter = InMemorySpanExporter()
        # A real Tracing instance gives us redact defaults + the credentials cache
        # the decorator touches; we just don't call its OTLP `configure()`.
        self._tracing = Tracing(url="http://in-memory.invalid/otlp/v1/traces")
        self._tracing.redact = None
        self._tracing.redact_on_error = True

        provider = TracerProvider(
            resource=Resource(attributes={"service.name": "agenta-sdk-test"})
        )
        provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self._tracing.tracer_provider = provider
        self._tracing.tracer = provider.get_tracer("agenta.tracer")

    @property
    def tracing(self):
        return self._tracing

    @property
    def tracer(self):
        return self._tracing.tracer

    def finished_spans(self):
        """All spans exported so far, in end order."""
        return list(self.exporter.get_finished_spans())

    def clear(self):
        self.exporter.clear()


@pytest.fixture
def in_memory_tracing():
    """Point `ag.tracer` / `ag.tracing` at an in-memory provider for one test."""
    saved_tracer = getattr(ag, "tracer", None)
    saved_tracing = getattr(ag, "tracing", None)

    harness = InMemoryTracing()
    ag.tracing = harness.tracing
    ag.tracer = harness.tracer

    try:
        yield harness
    finally:
        ag.tracer = saved_tracer
        ag.tracing = saved_tracing
