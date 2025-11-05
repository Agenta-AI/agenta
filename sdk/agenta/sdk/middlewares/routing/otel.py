from typing import Callable

from starlette.types import ASGIApp
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.engines.tracing.propagation import extract


log = get_module_logger(__name__)


class OTelMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        request.state.otel = {"baggage": {}, "traceparent": None}

        headers: dict = dict(request.headers)

        if "newrelic" in headers:
            headers["traceparent"] = None

        with suppress():
            _, traceparent, baggage = extract(headers)

            request.state.otel = {"baggage": baggage, "traceparent": traceparent}

        return await call_next(request)
