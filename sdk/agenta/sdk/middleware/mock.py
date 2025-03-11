from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

from agenta.sdk.utils.exceptions import suppress


class MockMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.mock = None

        with suppress():
            baggage = request.state.otel["baggage"]

            mock = (
                # CLEANEST
                baggage.get("mock")
                # ALTERNATIVE
                or request.query_params.get("mock")
            )

            request.state.mock = mock

        return await call_next(request)
