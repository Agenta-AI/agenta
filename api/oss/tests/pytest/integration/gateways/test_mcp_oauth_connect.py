"""WP31 dashboard/API OAuth flow over WP30's local provider contract.

WP30 separately tests discovery, exchange, and storage. This integration layer owns the
product composition: the management route discovers scopes, starts consent, completes
the browser callback, updates the endpoint handle, and reconnects for a scope step-up.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.apis.fastapi.gateways.mcps.router as router_module
from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.utils.context import AuthScope


pytestmark = [pytest.mark.integration]


def _fixture_or_skip(request: pytest.FixtureRequest, name: str):
    """Keep WP31 independently collectable until the WP30 fixture merges."""
    try:
        return request.getfixturevalue(name)
    except pytest.FixtureLookupError:
        pytest.skip(f"WP30 fixture `{name}` is not available yet")


class _EndpointStore:
    """Minimal persistence seam: the real OAuth service and router remain intact."""

    def __init__(self, endpoint: MCPEndpoint) -> None:
        self.endpoint = endpoint

    async def fetch_endpoint(self, *, project_id, endpoint_id):
        return self.endpoint if endpoint_id == self.endpoint.id else None

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        self.endpoint = MCPEndpoint.model_validate(endpoint.model_dump())
        return self.endpoint

    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None):
        return [self.endpoint]


@pytest.mark.integration
def test_dashboard_connect_callback_and_scope_step_up_share_one_grant_handle(
    request, monkeypatch
):
    provider = _fixture_or_skip(request, "local_mcp_oauth_provider")
    oauth_service, _dao = _fixture_or_skip(request, "local_mcp_oauth_connect_service")
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    endpoint = MCPEndpoint(
        id=endpoint_id,
        slug="local-oauth",
        auth_mode=GatewayAuthScheme.OAUTH,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url=provider.server_url)),
    )
    store = _EndpointStore(endpoint)
    router = MCPGatewayRouter(
        mcp_gateway_service=store, oauth_connect_service=oauth_service
    )
    app = FastAPI()
    app.include_router(router.router)

    monkeypatch.setattr(
        router_module,
        "get_auth_scope",
        lambda: AuthScope(
            organization_id=uuid4(),
            workspace_id=uuid4(),
            project_id=project_id,
            user_id=user_id,
        ),
    )

    async def _allow(**_kwargs) -> bool:
        return True

    monkeypatch.setattr(router_module, "check_action_access", _allow)
    # Production wires both the router and connect service from the same deployment
    # crypt key. The reusable fixture uses a deterministic test key,
    # so bind the router to that fixture key here rather than weakening state checks.
    monkeypatch.setattr(router_module.env.agenta, "crypt_key", oauth_service.secret_key)

    with TestClient(app, raise_server_exceptions=False) as client:
        # Dashboard opening the dialog: discover and cache the offered-scope checklist.
        discovery = client.post(f"/endpoints/{endpoint_id}/connect", json={})
        assert discovery.status_code == 200, discovery.text
        scopes = discovery.json()["scopes_offered"]
        assert scopes
        assert store.endpoint.data.oauth is not None

        def start_and_callback(selected_scopes: list[str]):
            start = client.post(
                f"/endpoints/{endpoint_id}/connect", json={"scopes": selected_scopes}
            )
            assert start.status_code == 200, start.text
            state = parse_qs(urlparse(start.json()["redirect_url"]).query)["state"][0]
            callback = client.get(
                "/connect/callback", params=provider.callback_params(state=state)
            )
            assert callback.status_code == 200, callback.text
            assert '"success": true' in callback.text

        start_and_callback([scopes[0]])
        first_handle = store.endpoint.secret_id
        assert first_handle is not None

        # A ready endpoint can reconnect from the dashboard when a new scope is needed.
        start_and_callback(scopes)
        assert store.endpoint.secret_id == first_handle


@pytest.mark.asyncio
async def test_local_provider_exchange_persists_a_handle_and_reconnect_reuses_it(
    local_mcp_oauth_provider, local_mcp_oauth_connect_service
):
    service, dao = local_mcp_oauth_connect_service
    project_id, user_id = uuid4(), uuid4()

    discovery = await service.discover(server_url=local_mcp_oauth_provider.server_url)
    assert (
        discovery.authorization_server == local_mcp_oauth_provider.authorization_server
    )
    assert discovery.authorization_endpoint == local_mcp_oauth_provider.authorize_url

    first_start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )
    first = await service.complete(
        **local_mcp_oauth_provider.callback_params(state=first_start.state)
    )

    assert first.secret_id is not None
    assert "access_token" not in first.model_dump(mode="json")
    assert "refresh_token" not in first.model_dump(mode="json")

    second_start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )
    second = await service.complete(
        **local_mcp_oauth_provider.callback_params(state=second_start.state)
    )

    grants = [record for _, record in dao.records if record.kind.value == "oauth_grant"]
    assert len(grants) == 1
    assert second.secret_id == first.secret_id == grants[0].id
