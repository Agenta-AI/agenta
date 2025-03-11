from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.tracing.propagation import extract


class OTelMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable):
        request.state.otel = {"baggage": {}, "traceparent": None}

        with suppress():
            _, traceparent, baggage = extract(request.headers)

            request.state.otel = {"baggage": baggage, "traceparent": traceparent}

        return await call_next(request)
