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

    def _has_prefix(self, path: str) -> bool:
        return path == self.prefix or path.startswith(self.prefix + "/")

    def _strip(self, scope):
        path = scope.get("path", "")
        # Starlette reads `path` as the full request path and `root_path` as the part a
        # proxy or `--root-path` already accounts for: a router matches `path` minus
        # `root_path`, and a Mount derives its child root from `root_path`. When the server
        # runs with `--root-path /services`, one copy of the prefix in `path` belongs to the
        # framework; stripping it leaves `root_path` stale and every mounted sub-app
        # (`/agent/v0`, ...) answers 404. Strip only the copies beyond that one.
        root_path = scope.get("root_path", "") or ""
        keep = 1 if self._has_prefix(root_path) else 0
        count = 0
        probe = path
        while self._has_prefix(probe):
            probe = probe[len(self.prefix) :] or "/"
            count += 1
        stripped = max(count - keep, 0)
        if not stripped:
            return scope
        for _ in range(stripped):
            path = path[len(self.prefix) :] or "/"
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
