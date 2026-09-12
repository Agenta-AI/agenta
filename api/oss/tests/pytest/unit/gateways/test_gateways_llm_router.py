"""LLM gateway router tests.

TestClient + a hand-written mock `LLMGatewayService` + a monkeypatched
`get_auth_scope()`/`check_action_access()` — no real database, no real service.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMGatewayConnectionResolution,
    LLMModelFilter,
)
from oss.src.utils.context import AuthScope


FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)

EXPECTED_ROUTES = {
    ("/resolve", "POST"): "resolve_llm_gateway_connection",
    ("/endpoints/", "POST"): "create_llm_endpoint",
    ("/endpoints/", "GET"): "list_llm_endpoints",
    ("/endpoints/query", "POST"): "query_llm_endpoints",
    ("/endpoints/{endpoint_id}", "GET"): "fetch_llm_endpoint",
    ("/endpoints/{endpoint_id}", "PUT"): "edit_llm_endpoint",
    ("/endpoints/{endpoint_id}", "DELETE"): "delete_llm_endpoint",
}


def _endpoint(endpoint_id) -> LLMEndpoint:
    return LLMEndpoint(
        id=endpoint_id,
        slug="acme-openai",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.DIRECT,
        data=LLMEndpointData(models=LLMModelFilter(allowlist=["gpt-4o"])),
    )


class MockLLMGatewayService:
    def __init__(self):
        self.calls = []
        self.create_return = None
        self.list_return = []
        self.query_return = []
        self.fetch_return = None
        self.edit_return = None
        self.delete_return = True
        self.resolve_return = LLMGatewayConnectionResolution(
            namespace="custom",
            name="acme-openai",
            provider_key="openai",
            deployment_kind="custom",
            model="gpt-4o",
        )

    async def resolve_agent_connection(
        self, *, scope, model, provider_key, connection_slug
    ):
        self.calls.append("resolve_agent_connection")
        return self.resolve_return

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


@pytest.fixture
def service():
    return MockLLMGatewayService()


@pytest.fixture
def router(service):
    return LLMGatewayRouter(llm_gateway_service=service)


@pytest.fixture
def client(router):
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _patch_auth_scope(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )


@pytest.fixture
def allow(monkeypatch):
    mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.check_action_access", mock
    )
    return mock


@pytest.fixture
def deny(monkeypatch):
    mock = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.check_action_access", mock
    )
    return mock


# ---------------------------------------------------------------------------
# Route table contract
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
# Each route reaches the right handler (happy path)
# ---------------------------------------------------------------------------


def test_resolve_agent_connection_returns_route_metadata_only(client, service, allow):
    response = client.post(
        "/resolve",
        json={
            "model": "gpt-4o",
            "provider_key": "openai",
            "connection_slug": "acme-openai",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "connection": {
            "namespace": "custom",
            "name": "acme-openai",
            "provider_key": "openai",
            "deployment_kind": "custom",
            "model": "gpt-4o",
        }
    }
    assert service.calls == ["resolve_agent_connection"]


def test_create_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.create_return = _endpoint(endpoint_id)

    response = client.post(
        "/endpoints/",
        json={
            "endpoint": {
                "slug": "acme-openai",
                "provider_key": "openai",
                "deployment_kind": "direct",
                "data": {"models": {"allowlist": ["gpt-4o"]}},
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
    service.fetch_return = _endpoint(endpoint_id)
    service.edit_return = _endpoint(endpoint_id)

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": str(endpoint_id),
                "data": {"models": {"allowlist": ["gpt-4o-mini"]}},
            }
        },
    )

    assert response.status_code == 200
    assert service.calls == ["fetch_endpoint", "edit_endpoint"]


def test_edit_endpoint_rejects_a_path_body_id_mismatch(client, service, allow):
    endpoint_id = uuid4()
    other_id = uuid4()

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={"endpoint": {"id": str(other_id), "data": {}}},
    )

    assert response.status_code == 400
    assert service.calls == []


def test_edit_endpoint_rejects_an_invalid_url_for_its_stored_deployment(
    client, service, allow
):
    endpoint_id = uuid4()
    service.fetch_return = LLMEndpoint(
        id=endpoint_id,
        slug="acme-bedrock",
        provider_key="bedrock",
        deployment_kind=LLMDeploymentKind.BEDROCK,
        data=LLMEndpointData(models=LLMModelFilter(allowlist=["claude-3-5-sonnet"])),
    )

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": str(endpoint_id),
                "data": {"route": {"base_url": "https://bedrock.example/v1"}},
            }
        },
    )

    assert response.status_code == 400
    assert service.calls == ["fetch_endpoint"]


def test_delete_endpoint_reaches_the_service(client, service, allow):
    endpoint_id = uuid4()
    service.delete_return = True

    response = client.delete(f"/endpoints/{endpoint_id}")

    assert response.status_code == 204
    assert service.calls == ["delete_endpoint"]


# ---------------------------------------------------------------------------
# A denied _check short-circuits before the mock service is called
# ---------------------------------------------------------------------------


# Fixed (not `uuid4()`-at-collection-time) so pytest-xdist workers agree on
# the parametrize IDs — a random id per worker process fails collection.
_A_FIXED_ID = "00000000-0000-0000-0000-000000000001"


@pytest.mark.parametrize(
    "method,path,json_body",
    [
        (
            "POST",
            "/endpoints/",
            {"endpoint": {"provider_key": "openai", "deployment_kind": "direct"}},
        ),
        ("GET", "/endpoints/", None),
        ("POST", "/endpoints/query", {}),
        ("GET", f"/endpoints/{_A_FIXED_ID}", None),
        ("PUT", f"/endpoints/{_A_FIXED_ID}", {"endpoint": {"data": {}}}),
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

    response = client.get(f"/endpoints/{uuid4()}")

    assert response.status_code == 404


def test_edit_endpoint_none_maps_to_404(client, service, allow):
    endpoint_id = uuid4()
    service.fetch_return = _endpoint(endpoint_id)
    service.edit_return = None

    response = client.put(
        f"/endpoints/{endpoint_id}",
        json={"endpoint": {"id": str(endpoint_id), "data": {}}},
    )

    assert response.status_code == 404


def test_delete_endpoint_false_maps_to_404(client, service, allow):
    service.delete_return = False

    response = client.delete(f"/endpoints/{uuid4()}")

    assert response.status_code == 404
