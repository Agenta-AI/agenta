from collections.abc import Callable, Sequence

from starlette.routing import BaseRoute, Match

API_PREFIX = "/api"


class ApiPrefixStripMiddleware:
    """Normalize the request path so every hop shape routes, without ever issuing a redirect.

    Two normalizations, both inbound:

    `/api` prefixes are stripped, because hops disagree about them. Local traefik forwards
    `/api` intact, a direct container hop has no prefix, and an AWS ALB forwards the public
    path verbatim. Routes live at root (`root_path="/api"` is docs metadata). Strips in a
    loop, so a double-prefixed caller (`/api/api/...`) still routes.

    The trailing slash is then matched to whatever the route actually declares. This replaces
    Starlette's `redirect_slashes`, which is disabled in the composition root. That redirect
    was built from the post-strip path, so behind a path-prefixed proxy its `Location` lost
    the prefix and pointed at whatever serves the root (the web UI), turning an API call into
    an HTML 404. Correcting the `Location` instead would trade that for a redirect loop
    against any client holding a cached slash-normalizing 308. Resolving the path here means
    no `Location` is ever emitted, so neither failure exists.
    """

    def __init__(
        self,
        app,
        routes: Callable[[], Sequence[BaseRoute]] | None = None,
    ):
        self.app = app
        self._routes = routes

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = self._normalize(scope)
        await self.app(scope, receive, send)

    def _normalize(self, scope):
        path = scope.get("path", "")
        raw = scope.get("raw_path")
        changed = False

        while path == API_PREFIX or path.startswith(API_PREFIX + "/"):
            path = path[len(API_PREFIX) :] or "/"
            changed = True

        alternate = path[:-1] if path.endswith("/") and path != "/" else path + "/"
        if alternate and not self._known(scope, path) and self._known(scope, alternate):
            path = alternate
            changed = True

        if changed:
            scope = dict(scope)
            scope["path"] = path
            # `raw_path` is the original, still-encoded bytes (e.g. a percent-encoded prefix
            # like `/%61pi/foo` decodes to the same `path` a literal `/api/foo` would, but
            # doesn't share its byte prefix, so it can't be stripped the same way). Re-deriving
            # it from the now-normalized `path` keeps the two in lockstep instead of risking a
            # stale/divergent `raw_path` that no longer matches where the request actually routes.
            if isinstance(raw, (bytes, bytearray)):
                scope["raw_path"] = path.encode("utf-8")
        return scope

    def _known(self, scope, path) -> bool:
        """Whether any route claims `path`. A method mismatch still counts: 405 is the honest
        answer there, and rewriting the slash would hide it behind a 404."""
        if self._routes is None:
            return False
        probe = dict(scope)
        probe["path"] = path
        for route in self._routes():
            match, _ = route.matches(probe)
            if match is not Match.NONE:
                return True
        return False
