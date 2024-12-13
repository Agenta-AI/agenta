from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

from opentelemetry.baggage.propagation import W3CBaggagePropagator

from agenta.sdk.utils.exceptions import suppress


class OTelMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable):
        request.state.otel = {}

        with suppress():
            baggage = await self._get_baggage(request)

            request.state.otel = {"baggage": baggage}

        return await call_next(request)

    async def _get_baggage(
        self,
        request,
    ):
        _baggage = {"baggage": request.headers.get("Baggage", "")}

        context = W3CBaggagePropagator().extract(_baggage)

        baggage = {}

        if context:
            for partial in context.values():
                for key, value in partial.items():
                    baggage[key] = value

        return baggage
