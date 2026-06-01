"""Unit tests for selector propagation onto trace spans.

Covers the path from `_merge_tracing_selector` (resolver) → `TracingContext.selector`
→ the span attribute `ag.selector.key` written by `TraceProcessor.on_start`.
"""

from unittest.mock import Mock


from agenta.sdk.contexts.tracing import (
    TracingContext,
    tracing_context_manager,
)
from agenta.sdk.middlewares.running.resolver import _merge_tracing_selector


def _make_span():
    span = Mock()
    span.set_attribute = Mock()
    return span


def _selector_attrs(span):
    """Return the ag.selector.* attributes set on the span."""
    return {
        call.args[0]: call.args[1]
        for call in span.set_attribute.call_args_list
        if call.args and str(call.args[0]).startswith("ag.selector.")
    }


def test_merge_tracing_selector_sets_context_dict():
    with tracing_context_manager(TracingContext()):
        _merge_tracing_selector({"key": "demo.revision"})

        assert TracingContext.get().selector == {"key": "demo.revision"}


def test_merge_tracing_selector_none_leaves_context_unset():
    with tracing_context_manager(TracingContext()):
        _merge_tracing_selector(None)

        assert TracingContext.get().selector is None


def test_processor_writes_selector_key_when_present():
    from agenta.sdk.engines.tracing.processors import TraceProcessor

    processor = TraceProcessor(span_exporter=Mock(), inline=True)
    span = _make_span()
    span.context = Mock(trace_id=1, span_id=2)

    with tracing_context_manager(TracingContext(selector={"key": "demo.revision"})):
        processor.on_start(span, parent_context=None)

    assert _selector_attrs(span) == {"ag.selector.key": "demo.revision"}


def test_processor_omits_selector_key_when_absent():
    from agenta.sdk.engines.tracing.processors import TraceProcessor

    processor = TraceProcessor(span_exporter=Mock(), inline=True)
    span = _make_span()
    span.context = Mock(trace_id=1, span_id=2)

    with tracing_context_manager(TracingContext(selector=None)):
        processor.on_start(span, parent_context=None)

    assert _selector_attrs(span) == {}
