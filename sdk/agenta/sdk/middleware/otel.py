from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.tracing.propagation import extract

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


class OTelMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable):
        request.state.otel = {"baggage": {}, "traceparent": None}

        headers = dict(request.headers)

        if "newrelic" in headers:
            headers["traceparent"] = None

        with suppress():
            _, traceparent, baggage = extract(headers)

            request.state.otel = {"baggage": baggage, "traceparent": traceparent}

        return await call_next(request)
