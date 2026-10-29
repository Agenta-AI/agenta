from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class SuperTokensHTTPExceptionMiddleware:
    """SuperTokens serves /auth/* from a middleware, outside FastAPI's exception handlers.

    An HTTPException its API overrides raise (the Turnstile check) would otherwise be a 500.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except HTTPException as exc:
            if response_started:
                raise
            response = JSONResponse(
                {"detail": exc.detail},
                status_code=exc.status_code,
                headers=exc.headers,
            )
            await response(scope, receive, send)
