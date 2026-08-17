"""Router wiring — apis/fastapi/gateways/mcps/oauth_router.py (specs-wp20.md).

TestClient against a bare FastAPI app carrying only this router — no auth middleware,
no database. The auth-exemption itself (`middlewares/auth.py`'s `_PUBLIC_ENDPOINTS`)
is a one-line addition verified by inspection, not a live-middleware test.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.oauth_router import MCPOAuthClientMetadataRouter
from oss.src.core.gateways.mcps.oauth.registration import client_metadata_url
from oss.src.core.gateways.mcps.oauth.service import callback_redirect_uri
from oss.src.utils.env import env


def _client() -> TestClient:
    router = MCPOAuthClientMetadataRouter()
    app = FastAPI()
    app.include_router(router=router.router, prefix="/gateways/mcps")
    return TestClient(app)


def test_serves_a_client_metadata_document_with_no_auth_header():
    response = _client().get("/gateways/mcps/oauth/client-metadata.json")

    assert response.status_code == 200
    body = response.json()
    assert body["token_endpoint_auth_method"] == "none"
    assert "client_secret" not in body
    assert body["redirect_uris"] == [callback_redirect_uri(api_url=env.agenta.api_url)]


def test_the_served_document_has_no_client_id_field():
    """The client_id is the document's own URL (specs-wp20.md); it is never a field
    inside the document itself."""
    body = _client().get("/gateways/mcps/oauth/client-metadata.json").json()

    assert "client_id" not in body


def test_client_metadata_url_matches_the_route_the_router_serves():
    from oss.src.utils.env import env

    assert client_metadata_url(api_url=env.agenta.api_url).endswith(
        "/gateways/mcps/oauth/client-metadata.json"
    )
