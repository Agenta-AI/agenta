"""The services app must route with and without the public `/services` prefix.

Traefik strips the prefix; a managed ingress (GKE) forwards it verbatim. Both shapes must
reach the same route, and no redirect may be issued on the way.
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


def _mounted_app(root_path: str) -> TestClient:
    """A sub-app mounted under a path, served with uvicorn's `--root-path` shape.

    Uvicorn keeps `root_path` at the front of `path` even when the proxy stripped it
    from the wire, so the client requests the prefixed path here too.
    """
    sub = FastAPI()

    @sub.get("/invoke")
    async def invoke():
        return {"mounted": True}

    app = FastAPI()
    app.mount("/agent/v0", sub)
    app.add_middleware(ServicesPrefixStripMiddleware)
    return TestClient(app, root_path=root_path)


def test_mounted_sub_app_routes_under_root_path():
    # Stripping the prefix out of `path` while `root_path` still carries it leaves
    # `path` no longer starting with `root_path`, and every Mount answers 404.
    r = _mounted_app("/services").get("/services/agent/v0/invoke")
    assert r.status_code == 200, r.text
    assert r.json() == {"mounted": True}


def test_mounted_sub_app_routes_when_the_ingress_repeats_the_prefix():
    r = _mounted_app("/services").get("/services/services/agent/v0/invoke")
    assert r.status_code == 200, r.text


def test_mounted_sub_app_routes_without_a_root_path():
    r = _mounted_app("").get("/services/agent/v0/invoke")
    assert r.status_code == 200, r.text
