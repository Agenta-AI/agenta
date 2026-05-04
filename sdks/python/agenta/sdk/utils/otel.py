from opentelemetry import context as otel_context
from opentelemetry.trace import get_current_span
from opentelemetry.baggage import get_all as get_all_baggage


def debug_otel_context(label: str = "OTEL CONTEXT"):
    ctx = otel_context.get_current()
    span = get_current_span()
    baggage = get_all_baggage(ctx)

    print("\n===== {} =====".format(label))
    print("Context object:", ctx)
    print("Baggage:", baggage or "{}")
    if span and span.get_span_context().is_valid:
        print("Current Span:")
        print("  Trace ID:", format(span.get_span_context().trace_id, "032x"))
        print("  Span  ID:", format(span.get_span_context().span_id, "016x"))
        # print("  Is Recording:", span.is_recording())
    else:
        print("Current Span: None or Invalid")
    print("=" * 40)
