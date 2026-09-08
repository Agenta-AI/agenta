"""The services app must route with and without the public `/services` prefix.

Traefik strips the prefix; a managed ingress (GKE) forwards it verbatim. Both shapes must
reach the same route, and no redirect may be issued on the way.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from entrypoints.prefix import ServicesPrefixStripMiddleware


def _app(prefix=None) -> TestClient:
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

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
