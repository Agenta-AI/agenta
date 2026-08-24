"""Router wiring — apis/fastapi/gateways/mcps/router.py (entities.md §9).

TestClient + a hand-written mock `MCPGatewayService` + a monkeypatched
`get_auth_scope()`/`check_action_access()` — no real database, no real service.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.state import make_state
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthDiscoveryError
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env


FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)

EXPECTED_ROUTES = {
    ("/endpoints/", "POST"): "create_mcp_endpoint",
    ("/endpoints/", "GET"): "list_mcp_endpoints",
    ("/endpoints/query", "POST"): "query_mcp_endpoints",
    ("/endpoints/{endpoint_id}", "GET"): "fetch_mcp_endpoint",
    ("/endpoints/{endpoint_id}", "PUT"): "edit_mcp_endpoint",
    ("/endpoints/{endpoint_id}", "DELETE"): "delete_mcp_endpoint",
    ("/endpoints/{endpoint_id}/connect", "POST"): "connect_mcp_endpoint",
    ("/connect/callback", "GET"): "mcp_connect_callback",
}

_SERVER_URL = "https://mcp.acme.example/notion"

# Fixed (not `uuid4()`-at-collection-time) so pytest-xdist workers agree on
# the parametrize IDs — a random id per worker process fails collection.
_A_FIXED_ID = "00000000-0000-0000-0000-000000000001"


def _endpoint(endpoint_id) -> MCPEndpoint:
    return MCPEndpoint(
        id=endpoint_id,
        slug="acme-notion",
        auth_mode=MCPAuthScheme.NONE,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp.acme.example/notion")
        ),
    )


def _oauth_endpoint(endpoint_id, *, secret_id=None) -> MCPEndpoint:
    return MCPEndpoint(
        id=endpoint_id,
        slug="acme-notion",
        auth_mode=MCPAuthScheme.OAUTH,
        secret_id=secret_id,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
    )


class MockMCPGatewayService:
    def __init__(self):
        self.calls = []
        self.create_return = None
        self.list_return = []
        self.query_return = []
        self.fetch_return = None
        self.edit_return = None
        self.delete_return = True

    async def create_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append("create_endpoint")
        return self.create_return

    async def list_endpoints(self, *, scope):
        self.calls.append("list_endpoints")
        return self.list_return

    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None):
        self.calls.append("query_endpoints")
        return self.query_return

    async def fetch_endpoint(self, *, project_id, endpoint_id):
        self.calls.append("fetch_endpoint")
        return self.fetch_return

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append("edit_endpoint")
        return self.edit_return

    async def delete_endpoint(self, *, project_id, endpoint_id):
        self.calls.append("delete_endpoint")
        return self.delete_return


class MockMCPOAuthConnectService:
    def __init__(self):
        self.calls = []
        self.discover_return = MCPOAuthDiscovery(
            resource=_SERVER_URL,
            authorization_server="https://auth.acme.example/",
            scopes_offered=["read", "write"],
            authorization_endpoint="https://auth.acme.example/authorize",
            token_endpoint="https://auth.acme.example/token",
        )
        self.discover_raises = None
        self.begin_return = MCPOAuthAuthorizationStart(
            authorization_url="https://auth.acme.example/authorize?client_id=abc",
            state="signed-state",
        )
        self.complete_return = None

    async def discover(self, *, server_url):
        self.calls.append(("discover", server_url))
        if self.discover_raises:
            raise self.discover_raises
        return self.discover_return

    async def begin(self, *, project_id, user_id, server_url, scopes):
        self.calls.append(("begin", server_url, tuple(scopes)))
        return self.begin_return

    async def complete(self, *, code, state):
        self.calls.append(("complete", code, state))
        if self.complete_return is None:
            raise AssertionError("complete_return not set")
        return self.complete_return


@pytest.fixture
def service():
    return MockMCPGatewayService()


@pytest.fixture
def oauth_service():
    return MockMCPOAuthConnectService()


@pytest.fixture
def router(service, oauth_service):
    return MCPGatewayRouter(
        mcp_gateway_service=service, oauth_connect_service=oauth_service
    )


@pytest.fixture
def client(router):
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _patch_auth_scope(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )


@pytest.fixture
def allow(monkeypatch):
    mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access", mock
    )
    return mock


@pytest.fixture
def deny(monkeypatch):
    mock = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access", mock
    )
    return mock


# ---------------------------------------------------------------------------
# Route table — path, method and operation_id match entities.md §9 exactly
# ---------------------------------------------------------------------------


def test_route_table_matches_the_design_exactly(router):
    actual = {}
    for route in router.router.routes:
        for method in route.methods:
            if method == "HEAD":
                continue
            actual[(route.path, method)] = route.operation_id

    assert actual == EXPECTED_ROUTES


# ---------------------------------------------------------------------------
# POST /endpoints/{id}/connect — the two-step consent flow (specs-wp18.md)
# ---------------------------------------------------------------------------


def test_connect_discover_step_caches_scopes_and_returns_the_checklist(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)

    response = client.post(f"/endpoints/{endpoint_id}/connect", json={})

    assert response.status_code == 200
    body = response.json()
    assert body.get("redirect_url") is None
    assert body["scopes_offered"] == ["read", "write"]
    assert oauth_service.calls == [("discover", _SERVER_URL)]
    assert service.calls == ["fetch_endpoint", "edit_endpoint"]


def test_connect_begin_step_returns_the_redirect_url(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)

    response = client.post(
        f"/endpoints/{endpoint_id}/connect", json={"scopes": ["read"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["redirect_url"] == oauth_service.begin_return.authorization_url
    assert oauth_service.calls == [("begin", _SERVER_URL, ("read",))]
    # No discovery-caching edit_endpoint call on the begin step.
    assert service.calls == ["fetch_endpoint"]


@pytest.mark.parametrize("scopes", [["read", "read"], ["read", " "]])
def test_connect_rejects_ambiguous_or_blank_scope_selection(
    client, service, oauth_service, allow, scopes
):
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)

    response = client.post(f"/endpoints/{endpoint_id}/connect", json={"scopes": scopes})

    assert response.status_code == 422
    assert service.calls == []
    assert oauth_service.calls == []


def test_connect_missing_endpoint_404s(client, service, oauth_service, allow):
    service.fetch_return = None

    response = client.post(f"/endpoints/{_A_FIXED_ID}/connect", json={})

    assert response.status_code == 404
    assert oauth_service.calls == []


def test_connect_rejects_a_non_oauth_endpoint(client, service, oauth_service, allow):
    endpoint_id = uuid4()
    service.fetch_return = _endpoint(endpoint_id)  # auth_mode=NONE

    response = client.post(f"/endpoints/{endpoint_id}/connect", json={})

    assert response.status_code == 400
    assert oauth_service.calls == []


def test_connect_denied_check_short_circuits_before_the_service_is_called(
    client, service, oauth_service, deny
):
    response = client.post(f"/endpoints/{_A_FIXED_ID}/connect", json={})

    assert response.status_code == 403
    assert service.calls == []
    assert oauth_service.calls == []


def test_connect_discovery_failure_surfaces_its_own_message(
    client, service, oauth_service, allow
):
    """OD21-inherited constraint: a discovery failure must say what happened,
    not a generic connect error (specs-wp18.md)."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    oauth_service.discover_raises = MCPOAuthDiscoveryError(
        server_url=_SERVER_URL, detail="no protected-resource metadata found"
    )

    response = client.post(f"/endpoints/{endpoint_id}/connect", json={})

    assert response.status_code == 424
    assert _SERVER_URL in response.json()["detail"]
    assert "no protected-resource metadata found" in response.json()["detail"]


# ---------------------------------------------------------------------------
# GET /connect/callback — unauthenticated, driven entirely by `state`
# ---------------------------------------------------------------------------


def _signed_state(*, project_id, user_id, scopes=None):
    return make_state(
        project_id=project_id,
        user_id=user_id,
        server_url=_SERVER_URL,
        code_verifier="a" * 43,
        scopes=scopes or ["read"],
        secret_key=env.agenta.crypt_key,
    )


def test_callback_completes_and_puts_the_secret_id_onto_the_matching_endpoint(
    client, service, oauth_service
):
    endpoint_id = uuid4()
    project_id, user_id = uuid4(), uuid4()
    secret_id = uuid4()
    service.query_return = [_oauth_endpoint(endpoint_id)]
    oauth_service.complete_return = MCPOAuthCompletion(
        project_id=project_id, server_url=_SERVER_URL, secret_id=secret_id
    )
    state = _signed_state(project_id=project_id, user_id=user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": state}
    )

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "mcp:oauth:connected" in response.text
    assert service.calls == ["query_endpoints", "edit_endpoint"]
    assert oauth_service.calls == [("complete", "auth-code", state)]


def test_callback_with_no_matching_endpoint_renders_a_failure_card(
    client, service, oauth_service
):
    project_id, user_id = uuid4(), uuid4()
    service.query_return = []  # nothing registered for this server_url
    oauth_service.complete_return = MCPOAuthCompletion(
        project_id=project_id, server_url=_SERVER_URL, secret_id=uuid4()
    )
    state = _signed_state(project_id=project_id, user_id=user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": state}
    )

    assert response.status_code == 400
    assert "No matching MCP endpoint" in response.text
    assert service.calls == ["query_endpoints"]  # no edit_endpoint call


def test_callback_with_authorization_server_error_renders_a_failure_card_without_completing(
    client, service, oauth_service
):
    response = client.get(
        "/connect/callback",
        params={"error": "access_denied", "error_description": "User declined"},
    )

    assert response.status_code == 400
    assert "User declined" in response.text
    assert '"success": false' in response.text
    assert "mcp:oauth:connected" in response.text
    assert oauth_service.calls == []
    assert service.calls == []


def test_callback_with_a_tampered_state_renders_a_failure_card(
    client, service, oauth_service
):
    project_id, user_id = uuid4(), uuid4()
    state = _signed_state(project_id=project_id, user_id=user_id)
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": tampered}
    )

    assert response.status_code == 400
    assert "invalid or expired" in response.text.lower()
    assert oauth_service.calls == []
    assert service.calls == []


# ---------------------------------------------------------------------------
# Each route reaches the right handler (happy path)
# ---------------------------------------------------------------------------


def test_create_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.create_return = _endpoint(endpoint_id)

    response = client.post(
        "/endpoints/",
        json={
            "endpoint": {
                "slug": "acme-notion",
                "auth_mode": "none",
                "data": {"route": {"base_url": "https://mcp.acme.example/notion"}},
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["endpoint"]["id"] == str(endpoint_id)
    assert service.calls == ["create_endpoint"]


def test_list_endpoints_reaches_the_service(client, service, allow):
    service.list_return = [_endpoint(uuid4())]

    response = client.get("/endpoints/")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert service.calls == ["list_endpoints"]


def test_query_endpoints_reaches_the_service(client, service, allow):
    service.query_return = [_endpoint(uuid4())]

    response = client.post("/endpoints/query", json={})

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert service.calls == ["query_endpoints"]


def test_fetch_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.fetch_return = _endpoint(endpoint_id)

    response = client.get(f"/endpoints/{endpoint_id}")

    assert response.status_code == 200
    assert response.json()["endpoint"]["id"] == str(endpoint_id)
    assert service.calls == ["fetch_endpoint"]


def test_edit_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.edit_return = _endpoint(endpoint_id)

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": str(endpoint_id),
                "auth_mode": "none",
                "data": {"route": {"base_url": "https://mcp.acme.example/notion"}},
            }
        },
    )

    assert response.status_code == 200
    assert service.calls == ["edit_endpoint"]


def test_edit_endpoint_rejects_a_path_body_id_mismatch(client, service, allow):
    endpoint_id = uuid4()
    other_id = uuid4()

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": str(other_id),
                "auth_mode": "none",
                "data": {"route": {"base_url": "https://mcp.acme.example/notion"}},
            }
        },
    )

    assert response.status_code == 400
    assert service.calls == []


def test_delete_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.delete_return = True

    response = client.delete(f"/endpoints/{endpoint_id}")

    assert response.status_code == 204
    assert service.calls == ["delete_endpoint"]


# ---------------------------------------------------------------------------
# A denied _check short-circuits before the mock service is called
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,json_body",
    [
        (
            "POST",
            "/endpoints/",
            {
                "endpoint": {
                    "auth_mode": "none",
                    "data": {"route": {"base_url": "https://example.com"}},
                }
            },
        ),
        ("GET", "/endpoints/", None),
        ("POST", "/endpoints/query", {}),
        ("GET", f"/endpoints/{_A_FIXED_ID}", None),
        (
            "PUT",
            f"/endpoints/{_A_FIXED_ID}",
            {
                "endpoint": {
                    "auth_mode": "none",
                    "data": {"route": {"base_url": "https://example.com"}},
                }
            },
        ),
        ("DELETE", f"/endpoints/{_A_FIXED_ID}", None),
    ],
)
def test_denied_check_short_circuits_before_the_service_is_called(
    client, service, deny, method, path, json_body
):
    response = client.request(method, path, json=json_body)

    assert response.status_code == 403
    assert service.calls == []


# ---------------------------------------------------------------------------
# None/False from the service maps to 404
# ---------------------------------------------------------------------------


def test_fetch_endpoint_none_maps_to_404(client, service, allow):
    service.fetch_return = None

    response = client.get(f"/endpoints/{_A_FIXED_ID}")

    assert response.status_code == 404


def test_edit_endpoint_none_maps_to_404(client, service, allow):
    service.edit_return = None

    response = client.put(
        f"/endpoints/{_A_FIXED_ID}",
        json={
            "endpoint": {
                "id": _A_FIXED_ID,
                "auth_mode": "none",
                "data": {"route": {"base_url": "https://mcp.acme.example/notion"}},
            }
        },
    )

    assert response.status_code == 404


def test_delete_endpoint_false_maps_to_404(client, service, allow):
    service.delete_return = False

    response = client.delete(f"/endpoints/{_A_FIXED_ID}")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Wave-1: grant methods are declared-but-NotImplementedError; the mapping
# table does not catch it, so it propagates as an unhandled 500. Expected,
# not a bug to fix here (specs-wp10.md, tasks-wp10.md).
# ---------------------------------------------------------------------------
