from os import getenv

from starlette.types import ASGIApp, Receive, Scope, Send
from fastapi.middleware.cors import CORSMiddleware as _CORSMiddleware

_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_USE_CORS = getenv("AGENTA_USE_CORS", "enable").lower() in _TRUTHY


class CORSMiddleware(_CORSMiddleware):
    def __init__(self, app: ASGIApp):
        self.app = app

        if _USE_CORS:
            super().__init__(
                app=app,
                allow_origins=["*"],
                allow_methods=["*"],
                allow_headers=["*"],
                allow_credentials=True,
                expose_headers=None,
                max_age=None,
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if _USE_CORS:
            return await super().__call__(scope, receive, send)

        return await self.app(scope, receive, send)
