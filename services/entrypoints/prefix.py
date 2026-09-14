from os import getenv

DEFAULT_PREFIX = "/services"


class ServicesPrefixStripMiddleware:
    """Strip the public path prefix so every hop shape routes.

    The services app is published under `/services` on the shared host. Traefik and the
    AWS ALB strip that prefix before the request reaches the container, so the routes live at
    root. A managed ingress such as GKE cannot rewrite paths and forwards `/services/...`
    verbatim, which used to answer 404. This middleware strips the prefix inbound, in a
    loop so a double prefix still routes, and never issues a redirect. It mirrors the api's
    `ApiPrefixStripMiddleware`.

    The prefix comes from `AGENTA_SERVICES_PATH_PREFIX`, default `/services`. Set it to an
    empty string to turn the strip off.
    """

    def __init__(self, app, prefix: str | None = None):
        self.app = app
        raw = DEFAULT_PREFIX if prefix is None else prefix
        raw = getenv("AGENTA_SERVICES_PATH_PREFIX", raw) if prefix is None else raw
        self.prefix = raw.rstrip("/")

    async def __call__(self, scope, receive, send):
        if self.prefix and scope["type"] in ("http", "websocket"):
            scope = self._strip(scope)
        await self.app(scope, receive, send)

    def _strip(self, scope):
        path = scope.get("path", "")
        stripped = 0
        while path == self.prefix or path.startswith(self.prefix + "/"):
            path = path[len(self.prefix) :] or "/"
            stripped += 1
        if not stripped:
            return scope
        scope = dict(scope)
        scope["path"] = path
        raw = scope.get("raw_path")
        if isinstance(raw, (bytes, bytearray)):
            # Keep the wire bytes: drop the consumed prefix from the front of the
            # original encoded path instead of re-encoding the decoded one, so a
            # percent-encoded segment such as caf%C3%A9 reaches the app unchanged.
            raw_prefix = self.prefix.encode("utf-8")
            raw_path = bytes(raw)
            for _ in range(stripped):
                if raw_path == raw_prefix or raw_path.startswith(raw_prefix + b"/"):
                    raw_path = raw_path[len(raw_prefix) :] or b"/"
                else:
                    raw_path = path.encode("utf-8")
                    break
            scope["raw_path"] = raw_path
        return scope
