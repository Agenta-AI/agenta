class ApiPrefixStripMiddleware:
    """Strip leading `/api` prefixes so hops that don't strip it (e.g. an ALB) still route.

    Local traefik strips `/api` before the app; a direct container hop has no prefix; an AWS
    ALB forwards the public `/api/...` path verbatim. Routes live at root (`root_path="/api"`
    is docs metadata), so accepting both shapes here makes every topology work with one URL.
    Strips in a loop, not once: a double-prefixed caller (`/api/api/...`) still routes.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            raw = scope.get("raw_path")
            stripped = False
            while path == "/api" or path.startswith("/api/"):
                path = path[4:] or "/"
                if isinstance(raw, (bytes, bytearray)) and raw[:4] == b"/api":
                    raw = bytes(raw)[4:] or b"/"
                stripped = True
            if stripped:
                scope = dict(scope)
                scope["path"] = path
                scope["raw_path"] = raw
        await self.app(scope, receive, send)
