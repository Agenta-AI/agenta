from typing import Callable

from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import display_exception

# Import shared auth logic from middlewares/routing/auth.py
from agenta.sdk.middlewares.routing.auth import (
    get_credentials,
    DenyException,
    DenyResponse,
    _strip_service_prefix,
    _ALWAYS_ALLOW_LIST,
)

import agenta as ag

log = get_module_logger(__name__)


class AuthHTTPMiddleware(BaseHTTPMiddleware):
    """Auth middleware for HTTP context (FastAPI services)."""

    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

    async def dispatch(self, request: Request, call_next: Callable):
        try:
            if _strip_service_prefix(request.url.path) in _ALWAYS_ALLOW_LIST:
                request.state.auth = {}

            else:
                credentials = await get_credentials(
                    request,
                    self.host,
                    self.scope_type,
                    self.scope_id,
                )

                request.state.auth = {"credentials": credentials}

            return await call_next(request)

        except DenyException as deny:
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=deny.status_code,
                detail=deny.content,
                headers=deny.headers,
            )

        except Exception:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=500,
                detail="Auth: Unexpected Error.",
            )
