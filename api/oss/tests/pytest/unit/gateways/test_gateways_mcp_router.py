"""Router wiring — apis/fastapi/gateways/mcps/router.py (entities.md §9).

TestClient + a hand-written mock `McpGatewayService` + a monkeypatched
`get_auth_scope()`/`check_action_access()` — no real database, no real service.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.router import McpGatewayRouter
from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import McpEndpoint, McpEndpointData, McpGrant
from oss.src.utils.context import AuthScope


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
    ("/grants/query", "POST"): "query_mcp_grants",
    ("/grants/{grant_id}", "DELETE"): "revoke_mcp_grant",
}

# Fixed (not `uuid4()`-at-collection-time) so pytest-xdist workers agree on
# the parametrize IDs — a random id per worker process fails collection.
_A_FIXED_ID = "00000000-0000-0000-0000-000000000001"


def _endpoint(endpoint_id) -> McpEndpoint:
    return McpEndpoint(
        id=endpoint_id,
        slug="acme-notion",
        auth_mode=GatewayAuthScheme.NONE,
        data=McpEndpointData(url="https://mcp.acme.example/notion"),
    )


def _grant(grant_id) -> McpGrant:
    return McpGrant(id=grant_id, endpoint_id=uuid4(), secret_id=uuid4())


class MockMcpGatewayService:
    def __init__(self):
        self.calls = []
        self.create_return = None
        self.list_return = []
        self.query_return = []
        self.fetch_return = None
        self.edit_return = None
        self.delete_return = True
        self.query_grants_return = []
        self.revoke_grant_return = True
        self.raise_not_implemented_for_grants = False

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

    async def query_grants(self, *, project_id, grant=None, windowing=None):
        self.calls.append("query_grants")
        if self.raise_not_implemented_for_grants:
            raise NotImplementedError("query_grants (WP17/WP18)")
        return self.query_grants_return

    async def revoke_grant(self, *, project_id, grant_id):
        self.calls.append("revoke_grant")
        if self.raise_not_implemented_for_grants:
            raise NotImplementedError("revoke_grant (WP17/WP18)")
        return self.revoke_grant_return


@pytest.fixture
def service():
    return MockMcpGatewayService()


@pytest.fixture
def router(service):
    return McpGatewayRouter(mcp_gateway_service=service)


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


def test_connect_route_is_not_registered_wp18(client, service, allow):
    """POST /endpoints/{id}/connect is (WP18) — a deliberate absence, not an
    omission. FastAPI's own routing 404s it; nothing in this router handles it."""
    response = client.post(f"/endpoints/{_A_FIXED_ID}/connect", json={"scopes": []})

    assert response.status_code == 404
    assert service.calls == []


def test_connect_callback_route_is_not_registered_wp18(client, service, allow):
    response = client.get("/connect/callback")

    assert response.status_code == 404
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
                "data": {"url": "https://mcp.acme.example/notion"},
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
                "data": {"url": "https://mcp.acme.example/notion"},
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
                "data": {"url": "https://mcp.acme.example/notion"},
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


def test_query_grants_reaches_the_service(client, service, allow):
    service.query_grants_return = [_grant(uuid4())]

    response = client.post("/grants/query", json={})

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert service.calls == ["query_grants"]


def test_revoke_grant_reaches_the_service(client, service, allow):
    service.revoke_grant_return = True

    response = client.delete(f"/grants/{_A_FIXED_ID}")

    assert response.status_code == 204
    assert service.calls == ["revoke_grant"]


def test_revoke_grant_false_maps_to_404(client, service, allow):
    service.revoke_grant_return = False

    response = client.delete(f"/grants/{_A_FIXED_ID}")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# A denied _check short-circuits before the mock service is called
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,json_body",
    [
        (
            "POST",
            "/endpoints/",
            {"endpoint": {"auth_mode": "none", "data": {"url": "https://example.com"}}},
        ),
        ("GET", "/endpoints/", None),
        ("POST", "/endpoints/query", {}),
        ("GET", f"/endpoints/{_A_FIXED_ID}", None),
        (
            "PUT",
            f"/endpoints/{_A_FIXED_ID}",
            {"endpoint": {"auth_mode": "none", "data": {"url": "https://example.com"}}},
        ),
        ("DELETE", f"/endpoints/{_A_FIXED_ID}", None),
        ("POST", "/grants/query", {}),
        ("DELETE", f"/grants/{_A_FIXED_ID}", None),
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
                "data": {"url": "https://mcp.acme.example/notion"},
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


def test_query_grants_not_implemented_propagates_as_500(client, service, allow):
    service.raise_not_implemented_for_grants = True

    response = client.post("/grants/query", json={})

    assert response.status_code == 500


def test_revoke_grant_not_implemented_propagates_as_500(client, service, allow):
    service.raise_not_implemented_for_grants = True

    response = client.delete(f"/grants/{_A_FIXED_ID}")

    assert response.status_code == 500
