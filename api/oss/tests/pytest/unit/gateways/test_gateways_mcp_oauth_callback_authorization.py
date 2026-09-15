"""What the OAuth callback writes when the caller is no longer allowed to write.

The router's own tests mock the connect service, so they can only say that the service
was not called. These run the REAL `MCPOAuthConnectService` over a real `VaultService`
and assert on the vault itself: a caller who lost `EDIT_MCP_ENDPOINTS` while away at
the consent screen must leave no grant behind in the project.

The mock authorization server, the fake secrets DAO and the service wiring come from
`test_gateways_mcp_oauth_service`, so both modules describe the same server.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.utils.context import AuthScope
from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
    _SERVER_URL,
    _service,
)


class _EndpointStore:
    """Just enough endpoint persistence to see whether the callback edited anything."""

    def __init__(self, endpoint: MCPEndpoint) -> None:
        self.endpoint = endpoint
        self.edits = 0

    async def fetch_endpoint(self, *, project_id, endpoint_id):
        return self.endpoint if endpoint_id == self.endpoint.id else None

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        self.edits += 1
        self.endpoint = MCPEndpoint.model_validate(endpoint.model_dump())
        return self.endpoint

    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None):
        return [self.endpoint]


def _grants(dao, *, project_id):
    return [
        record
        for owner, record in dao.records
        if owner == project_id and record.kind.value == "oauth_grant"
    ]


@pytest.fixture
def callback(monkeypatch):
    """A callback the caller may no longer use, with the vault open for inspection.

    Returns the pieces the assertions need: the client, the attempt handle a real
    `begin()` issued, the endpoint store and the secrets DAO.
    """
    service, dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    store = _EndpointStore(
        MCPEndpoint(
            id=endpoint_id,
            slug="acme-notion",
            auth_mode=GatewayAuthScheme.OAUTH,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
        )
    )
    router = MCPGatewayRouter(
        mcp_gateway_service=store, oauth_connect_service=service, server_probe=None
    )
    app = FastAPI()
    app.include_router(router.router)

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope",
        lambda: AuthScope(
            organization_id=uuid4(),
            workspace_id=uuid4(),
            project_id=project_id,
            user_id=user_id,
        ),
    )

    # True while the person presses connect, False by the time they come back: they
    # were removed from the project while the consent screen was open.
    permitted = [True]

    async def _check_action_access(**_kwargs) -> bool:
        return permitted[0]

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access",
        _check_action_access,
    )

    async def _session_user(_request):
        return user_id

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.resolve_session_user_id",
        _session_user,
    )

    client = TestClient(app, raise_server_exceptions=False)
    start = client.post(f"/endpoints/{endpoint_id}/connect", json={"scopes": ["read"]})
    assert start.status_code == 200, start.text
    handle = parse_qs(urlparse(start.json()["redirect_url"]).query)["state"][0]
    permitted[0] = False

    return client, handle, store, dao, project_id


def test_a_caller_who_lost_permission_leaves_no_grant_in_the_project(callback):
    client, handle, store, dao, project_id = callback

    response = client.get(
        "/connect/callback", params={"code": "auth-code-1", "state": handle}
    )

    assert response.status_code == 403
    # The card, not a bare error: the browser is sitting on this page.
    assert "mcp:oauth:connected" in response.text
    assert _grants(dao, project_id=project_id) == []
    assert store.edits == 0
    assert store.endpoint.secret_id is None


def test_the_refused_attempt_is_spent_and_cannot_be_replayed(callback):
    """The handle was presented, so it is burnt whatever the answer was. The person
    starts the connection again, which is also what the card tells them."""
    client, handle, store, dao, project_id = callback

    refused = client.get(
        "/connect/callback", params={"code": "auth-code-1", "state": handle}
    )
    replay = client.get(
        "/connect/callback", params={"code": "auth-code-2", "state": handle}
    )

    assert refused.status_code == 403
    assert replay.status_code == 400
    assert "invalid or expired" in replay.text.lower()
    assert _grants(dao, project_id=project_id) == []
    assert store.edits == 0
