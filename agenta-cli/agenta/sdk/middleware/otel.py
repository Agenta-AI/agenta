from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

from agenta.sdk.utils.exceptions import suppress

from opentelemetry.baggage.propagation import W3CBaggagePropagator


class OTelMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.otel = None

        with suppress():
            baggage = {"baggage": request.headers.get("Baggage", "")}

            context = W3CBaggagePropagator().extract(baggage)

            if context:
                request.state.otel = {"baggage": {}}

                for _, partial in context.values():
                    for key, value in partial.items():
                        request.state.otel["baggage"][key] = value

        return await call_next(request)
