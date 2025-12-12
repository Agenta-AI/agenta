from typing import Any, Dict, Optional, Tuple

from agenta.sdk.contexts.tracing import TracingContext
from opentelemetry.baggage import set_baggage
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.context import get_current
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator


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
        raw_baggage = (
            headers.get("Baggage")  # Uppercase
            or headers.get("baggage")  # Lowercase
            or ""
        )
        _carrier = {"baggage": raw_baggage}

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
