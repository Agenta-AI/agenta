from typing import Tuple, Optional, Dict, Any

from opentelemetry.trace import Span, set_span_in_context, get_current_span
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.baggage import set_baggage
from opentelemetry.context import get_current

from agenta.sdk.contexts.tracing import TracingContext

import agenta as ag


def extract(
    headers: Dict[str, str],
) -> Tuple[Optional[str], Optional[Any], Dict[str, str]]:
    # --- Extract credentials --- #
    credentials = None

    try:
        credentials = (
            headers.get("Authorization")  # Uppercase
            or headers.get("authorization")  # Lowercase
            or None
        )

    except:  # pylint: disable=bare-except
        pass

    # --- Extract traceparent --- #
    traceparent = None

    try:
        _carrier = {
            "traceparent": headers.get("Traceparent")  # Uppercase
            or headers.get("traceparent")  # Lowercase
            or "",
        }

        _context = TraceContextTextMapPropagator().extract(_carrier)

        traceparent = _context
    except:  # pylint: disable=bare-except
        pass

    # --- Extract baggage --- #
    baggage = {}

    try:
        _carrier = {
            "baggage": headers.get("Baggage")  # Uppercase
            or headers.get("baggage")  # Lowercase
            or "",
        }

        _context = W3CBaggagePropagator().extract(_carrier)

        if _context:
            for partial in _context.values():
                for key, value in partial.items():
                    baggage[key] = value

    except:  # pylint: disable=bare-except
        pass

    # --- #
    return credentials, traceparent, baggage


def inject(
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    headers = headers or {}

    _context = get_current()

    ctx = TracingContext.get()

    # --- Inject traceparent --- #
    try:
        TraceContextTextMapPropagator().inject(headers, context=_context)

    except:  # pylint: disable=bare-except
        pass

    # --- Inject baggage --- #
    try:
        if ctx.baggage:
            for key, value in ctx.baggage.items():
                _context = set_baggage(key, value, context=_context)

        W3CBaggagePropagator().inject(headers, context=_context)

    except:  # pylint: disable=bare-except
        pass

    # --- Inject credentials --- #
    if ctx.credentials:
        headers["Authorization"] = ctx.credentials

    # --- #
    return headers
