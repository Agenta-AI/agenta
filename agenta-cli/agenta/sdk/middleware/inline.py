from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI


from agenta.sdk.utils.exceptions import suppress

from agenta.sdk.utils.constants import TRUTHY


class InlineMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.inline = False

        with suppress():
            inline = str(request.query_params.get("inline")) in TRUTHY

            request.state.inline = inline

        return await call_next(request)
