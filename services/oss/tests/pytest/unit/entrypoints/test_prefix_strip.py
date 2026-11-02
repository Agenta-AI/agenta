"""The services app must route with and without the public `/services` prefix.

Traefik strips the prefix; a managed ingress (GKE) forwards it verbatim. Both shapes must
reach the same route, and no redirect may be issued on the way.

The dev stacks add a third shape: Traefik strips the prefix, then uvicorn's `--root-path
/services` puts it back on `scope["path"]` and sets `scope["root_path"]`. Starlette
subtracts that `root_path` again at every `Mount`, so the prefix must survive there.
`TestClient(root_path=...)` reproduces that shape: it sets `scope["root_path"]` and sends
the request path verbatim, so a test writes the full path the app would see from uvicorn.
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from entrypoints.prefix import ServicesPrefixStripMiddleware


@pytest.fixture(autouse=True)
def _no_prefix_env(monkeypatch):
    """The default-prefix tests must not depend on the process environment."""
    monkeypatch.delenv("AGENTA_SERVICES_PATH_PREFIX", raising=False)


def _app(prefix=None) -> TestClient:
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/raw/{name}")
    async def raw(request: Request, name: str):
        return {"raw_path": request.scope["raw_path"].decode("latin-1")}

    app.add_middleware(ServicesPrefixStripMiddleware, prefix=prefix)
    return TestClient(app)


def test_routes_at_root():
    assert _app().get("/health").status_code == 200


def test_routes_with_public_prefix():
    r = _app().get("/services/health", follow_redirects=False)
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_double_prefix_still_routes():
    assert _app().get("/services/services/health").status_code == 200


def test_bare_prefix_maps_to_root():
    # "/services" alone becomes "/", which this app does not serve: 404, not a crash.
    assert _app().get("/services").status_code == 404


def test_empty_prefix_turns_the_strip_off():
    assert _app(prefix="").get("/services/health").status_code == 404


def test_env_prefix_is_honored(monkeypatch):
    monkeypatch.setenv("AGENTA_SERVICES_PATH_PREFIX", "/svc")
    client = _app()
    assert client.get("/svc/health").status_code == 200
    assert client.get("/services/health").status_code == 404


def test_raw_path_keeps_the_wire_encoding():
    r = _app().get("/services/raw/caf%C3%A9")
    assert r.status_code == 200
    assert r.json()["raw_path"] == "/raw/caf%C3%A9"


# --------------------------------------------------------------------------------------
# Mounted sub-apps under a server-set root_path
#
# `/health` is a top-level route and keeps working whatever the scope looks like, so it
# cannot catch this class of bug. Every real services route lives in a mounted sub-app.
# --------------------------------------------------------------------------------------


def _mounted_app(root_path: str = "", prefix=None) -> TestClient:
    """An app shaped like `entrypoints.main`: a top-level route plus mounted sub-apps."""
    sub = FastAPI()

    @sub.get("/inspect")
    async def inspect():
        return {"inspected": True}

    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/raw/{name}")
    async def raw(request: Request, name: str):
        return {"raw_path": request.scope["raw_path"].decode("latin-1")}

    app.mount("/agent/v0", sub)
    app.add_middleware(ServicesPrefixStripMiddleware, prefix=prefix)
    return TestClient(app, root_path=root_path)


def test_mounted_route_at_root_without_root_path():
    r = _mounted_app().get("/agent/v0/inspect")
    assert r.status_code == 200
    assert r.json() == {"inspected": True}


def test_mounted_route_with_public_prefix_and_no_root_path():
    # The managed-ingress shape this middleware was written for: the ingress cannot rewrite
    # paths, so the prefix arrives verbatim, and the server (gunicorn's uvicorn worker) sets
    # no root_path. The chart passes SCRIPT_NAME, which that worker ignores.
    r = _mounted_app().get("/services/agent/v0/inspect", follow_redirects=False)
    assert r.status_code == 200
    assert r.json() == {"inspected": True}


def test_mounted_route_under_uvicorn_root_path():
    # The dev-stack shape: uvicorn `--root-path /services` re-prepends the prefix that
    # Traefik stripped, so `root_path` already accounts for it and nothing may be consumed.
    client = _mounted_app(root_path="/services")
    r = client.get("/services/agent/v0/inspect", follow_redirects=False)
    assert r.status_code == 200
    assert r.json() == {"inspected": True}
    assert client.get("/services/health").status_code == 200


def test_double_prefix_under_root_path_strips_only_the_extra_one():
    # A managed ingress in front of a `--root-path` server: one prefix belongs to
    # `root_path`, the other is the ingress's and has to go.
    r = _mounted_app(root_path="/services").get("/services/services/agent/v0/inspect")
    assert r.status_code == 200
    assert r.json() == {"inspected": True}


def test_double_prefix_without_root_path_still_strips_both():
    assert _mounted_app().get("/services/services/agent/v0/inspect").status_code == 200


def test_raw_path_keeps_the_root_path_head():
    # `raw_path` must stay in lockstep with `path`, root_path head included.
    r = _mounted_app(root_path="/services").get("/services/services/raw/caf%C3%A9")
    assert r.status_code == 200
    assert r.json()["raw_path"] == "/services/raw/caf%C3%A9"


def test_root_path_is_never_rewritten():
    """`root_path` is the server's to set, so the strip may only ever shorten `path`.

    Rewriting `root_path` to match a shortened `path` would route just as well here, and
    would then hand every mounted sub-app and every `url_for` a mount point the server never
    published. This pins the narrower contract instead.
    """
    seen = {}

    async def app(scope, receive, send):
        seen.update(root_path=scope["root_path"], path=scope["path"])
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    for root_path, sent, expected_path in (
        # Managed ingress: no root_path, prefix arrives verbatim and is consumed.
        ("", "/services/agent/v0/inspect", "/agent/v0/inspect"),
        # Dev stack: uvicorn --root-path re-prepends the prefix Traefik stripped.
        ("/services", "/services/agent/v0/inspect", "/services/agent/v0/inspect"),
        # Both at once: one prefix is the server's, the other the ingress's.
        (
            "/services",
            "/services/services/agent/v0/inspect",
            "/services/agent/v0/inspect",
        ),
    ):
        seen.clear()
        client = TestClient(ServicesPrefixStripMiddleware(app), root_path=root_path)
        assert client.get(sent).status_code == 204
        assert seen["root_path"] == root_path
        assert seen["path"] == expected_path
