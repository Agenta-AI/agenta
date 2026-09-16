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

    Only the part of `path` after `root_path` is stripped. ASGI requires `path` to start
    with `root_path`, and uvicorn's `--root-path /services` keeps that prefix on `path`
    even when the proxy already removed it from the wire. Rewriting the whole path would
    leave `path` no longer starting with `root_path`, and Starlette's `Mount` would then
    hand each sub-app a path it cannot match, 404ing every mounted route.

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
        root_path = scope.get("root_path", "")
        # `root_path` already accounts for the copy of the prefix the mount point owns;
        # leave it in place and strip only what follows it.
        head = root_path if root_path and path.startswith(root_path) else ""
        tail = path[len(head) :] or "/"
        stripped = 0
        while tail == self.prefix or tail.startswith(self.prefix + "/"):
            tail = tail[len(self.prefix) :] or "/"
            stripped += 1
        if not stripped:
            return scope
        scope = dict(scope)
        scope["path"] = head + tail
        raw = scope.get("raw_path")
        if isinstance(raw, (bytes, bytearray)):
            # Keep the wire bytes: drop the consumed prefix from the front of the
            # original encoded path instead of re-encoding the decoded one, so a
            # percent-encoded segment such as caf%C3%A9 reaches the app unchanged.
            raw_prefix = self.prefix.encode("utf-8")
            raw_head = head.encode("utf-8")
            raw_path = bytes(raw)
            raw_tail = (
                raw_path[len(raw_head) :] if raw_path.startswith(raw_head) else raw_path
            )
            for _ in range(stripped):
                if raw_tail == raw_prefix or raw_tail.startswith(raw_prefix + b"/"):
                    raw_tail = raw_tail[len(raw_prefix) :] or b"/"
                else:
                    raw_tail = tail.encode("utf-8")
                    break
            scope["raw_path"] = raw_head + raw_tail
        return scope
