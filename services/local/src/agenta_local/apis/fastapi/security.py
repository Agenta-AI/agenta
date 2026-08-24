"""Browser session boundary: process cookie, Host/Origin pinning, JSON mutations."""

import secrets
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

COOKIE_NAME = "agenta_local_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Body-carrying mutations must declare JSON; bodyless DELETE only needs the cookie.
JSON_METHODS = {"POST", "PUT", "PATCH"}


@dataclass
class BrowserBoundary:
    """Process-lifetime cookie value plus the pinned loopback origin."""

    host: str
    port: int
    cookie_value: str = field(default_factory=lambda: secrets.token_urlsafe(32))

    @property
    def host_header(self) -> str:
        return f"{self.host}:{self.port}"

    @property
    def origin(self) -> str:
        return f"http://{self.host_header}"

    def rotate(self) -> None:
        self.cookie_value = secrets.token_urlsafe(32)

    def _attach_cookie(self, response: Response) -> Response:
        response.set_cookie(
            COOKIE_NAME,
            self.cookie_value,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return response


class BrowserBoundaryMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, boundary: BrowserBoundary) -> None:
        super().__init__(app)
        self._boundary = boundary

    async def dispatch(self, request: Request, call_next) -> Response:
        host = request.headers.get("host", "")
        if host != self._boundary.host_header:
            return _reject("invalid_host", f"host {host!r} is not the pinned origin")

        origin = request.headers.get("origin")
        if origin is not None and origin != self._boundary.origin:
            return _reject("invalid_origin", "origin does not match the pinned origin")

        has_cookie = request.cookies.get(COOKIE_NAME) == self._boundary.cookie_value
        if (
            request.method not in SAFE_METHODS
            and request.url.path != "/api/runtime/shutdown"
            and getattr(request.app.state, "shutting_down", False)
        ):
            return JSONResponse(
                status_code=503,
                content={
                    "code": "shutting_down",
                    "message": "Agenta Local is shutting down",
                    "retryable": False,
                },
            )
        if request.method in SAFE_METHODS:
            response = await call_next(request)
        else:
            if request.method in JSON_METHODS:
                content_type = request.headers.get("content-type", "")
                if not content_type.startswith("application/json"):
                    return _reject(
                        "invalid_content_type",
                        "mutations require Content-Type application/json",
                    )
            if not has_cookie:
                return _reject("missing_session", "browser session cookie required")
            response = await call_next(request)

        content_type = response.headers.get("content-type", "")
        if not has_cookie and content_type.startswith("text/html"):
            # Every HTML navigation replaces a stale/missing process cookie.
            self._boundary._attach_cookie(response)
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response


def issue_browser_cookie(boundary: BrowserBoundary, response: Response) -> Response:
    """Explicit issuance for the app-shell route."""
    return boundary._attach_cookie(response)


def _reject(code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"code": code, "message": message, "retryable": False},
    )
