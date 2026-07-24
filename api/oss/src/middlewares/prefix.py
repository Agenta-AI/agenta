from urllib.parse import urlsplit, urlunsplit

from starlette.datastructures import MutableHeaders

API_PREFIX = "/api"

# Starlette builds its trailing-slash redirect from the post-strip path, so a stripped request
# would otherwise be answered with a Location outside the prefix — landing on whatever serves
# the root (the web UI) instead of the API, as an HTML 404.
_REDIRECT_STATUSES = frozenset({307, 308})


class ApiPrefixStripMiddleware:
    """Strip leading `/api` prefixes so hops that don't strip it (e.g. an ALB) still route.

    Local traefik forwards `/api` intact; a direct container hop has no prefix; an AWS
    ALB forwards the public `/api/...` path verbatim. Routes live at root (`root_path="/api"`
    is docs metadata), so accepting both shapes here makes every topology work with one URL.
    Strips in a loop, not once: a double-prefixed caller (`/api/api/...`) still routes.

    Redirects are re-prefixed on the way out so they stay inside the API — see
    `_restore_prefix`.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            raw = scope.get("raw_path")
            stripped = False
            while path == API_PREFIX or path.startswith(API_PREFIX + "/"):
                path = path[len(API_PREFIX) :] or "/"
                if (
                    isinstance(raw, (bytes, bytearray))
                    and raw[: len(API_PREFIX)] == b"/api"
                ):
                    raw = bytes(raw)[len(API_PREFIX) :] or b"/"
                stripped = True
            if stripped:
                scope = dict(scope)
                scope["path"] = path
                scope["raw_path"] = raw
                if scope["type"] == "http":
                    send = _prefixing_send(send)
        await self.app(scope, receive, send)


def _prefixing_send(send):
    async def wrapped(message):
        if (
            message["type"] == "http.response.start"
            and message["status"] in _REDIRECT_STATUSES
        ):
            headers = MutableHeaders(raw=message["headers"])
            location = headers.get("location")
            if location:
                restored = _restore_prefix(location)
                if restored != location:
                    headers["location"] = restored
        await send(message)

    return wrapped


def _restore_prefix(location: str) -> str:
    """Put `/api` back on a redirect target the router built from the stripped path.

    Only touches root-relative paths that don't already carry the prefix, so absolute
    off-host redirects (e.g. the SuperTokens callback) are left alone.
    """
    parts = urlsplit(location)
    path = parts.path
    if not path.startswith("/"):
        return location
    if path == API_PREFIX or path.startswith(API_PREFIX + "/"):
        return location
    return urlunsplit(
        (parts.scheme, parts.netloc, API_PREFIX + path, parts.query, parts.fragment)
    )
