"""MCP gateway router tests.

TestClient + a hand-written mock `MCPGatewayService` + a monkeypatched
`get_auth_scope()`/`check_action_access()` — no real database, no real service.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.apis.fastapi.gateways.mcps.models import MCPAgentaCredentialRequest
from oss.src.core.access.permissions.types import Permission
from oss.src.middlewares.auth import GATEWAY_TOKEN_AUDIENCE
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthDiscoveryError
from oss.src.core.gateways.mcps.probe import (
    MCPProbeAuth,
    MCPProbeAuthMode,
    MCPServerProbeResult,
)
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthCallerMismatchError,
    MCPOAuthStateInvalidError,
)
from oss.src.utils.context import AuthScope


FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)

EXPECTED_ROUTES = {
    ("/credentials/agenta", "POST"): "issue_agenta_mcp_credential",
    ("/endpoints/", "POST"): "create_mcp_endpoint",
    ("/endpoints/", "GET"): "list_mcp_endpoints",
    ("/endpoints/query", "POST"): "query_mcp_endpoints",
    ("/endpoints/probe", "POST"): "probe_mcp_endpoint",
    ("/endpoints/{endpoint_id}", "GET"): "fetch_mcp_endpoint",
    ("/endpoints/{endpoint_id}", "PUT"): "edit_mcp_endpoint",
    ("/endpoints/{endpoint_id}", "DELETE"): "delete_mcp_endpoint",
    ("/endpoints/{endpoint_id}/connect", "POST"): "connect_mcp_endpoint",
    ("/endpoints/{endpoint_id}/connect", "DELETE"): "disconnect_mcp_endpoint",
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

    async def cache_endpoint_discovery(
        self, *, project_id, user_id, endpoint_id, oauth
    ):
        # Discovery metadata only: the route no longer replays the row it read (D31).
        self.calls.append("cache_endpoint_discovery")
        self.cached_oauth = oauth
        return self.edit_return

    async def bind_endpoint_secret(
        self, *, project_id, user_id, endpoint_id, secret_id
    ):
        # Records the handle it was given: a credential transition writes two columns,
        # so what a caller supplies is the whole of what it can change (D3).
        self.calls.append("bind_endpoint_secret")
        self.bound_secret_id = secret_id
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
        self.claim_return = None
        self.claim_raises = None
        self.complete_return = None
        self.complete_raises = None
        self.begun_endpoint_ids = []
        self.disconnect_return = True
        # Which connection each disconnect named. A disconnect that dropped the
        # neighbour's grant would be invisible without this.
        self.disconnected = []

    async def discover(self, *, server_url):
        self.calls.append(("discover", server_url))
        if self.discover_raises:
            raise self.discover_raises
        return self.discover_return

    async def begin(self, *, project_id, user_id, endpoint_id, server_url, scopes):
        self.calls.append(("begin", server_url, tuple(scopes)))
        self.begun_endpoint_ids.append(endpoint_id)
        return self.begin_return

    async def claim(self, *, state, caller_user_id):
        self.calls.append(("claim", state))
        if self.claim_raises is not None:
            raise self.claim_raises
        if self.claim_return is None:
            raise AssertionError("claim_return not set")
        # The real service refuses a stranger before consuming anything.
        if caller_user_id != self.claim_return.user_id:
            raise MCPOAuthCallerMismatchError()
        return self.claim_return

    async def disconnect(self, *, project_id, endpoint_id, server_url):
        self.calls.append(("disconnect", server_url))
        self.disconnected.append(endpoint_id)
        return self.disconnect_return

    async def complete(self, *, attempt, code):
        self.calls.append(("complete", code, attempt.state))
        if self.complete_raises is not None:
            raise self.complete_raises
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
        mcp_gateway_service=service,
        oauth_connect_service=oauth_service,
        server_probe=None,
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
# Builtin Agenta MCP credential mint
# ---------------------------------------------------------------------------

# A registered handler-mode platform op, and the two runtime gateway tools: the shapes a
# run's callback tools actually carry, so a request naming them is inside the catalog.
_READ_CONFIG_CALL_REF = "tools.agenta.read_config"
_COMMIT_REVISION_CALL_REF = "tools.agenta.commit_revision"


def _mint_request(**state):
    """A stand-in Request carrying only the auth state the mint reads."""
    return type("Request", (), {"state": type("State", (), dict(state))()})()


def _tool(name: str, call_ref: str) -> dict:
    return {"name": name, "call_ref": call_ref, "input_schema": {"type": "object"}}


@pytest.fixture
def signer(monkeypatch):
    mock = AsyncMock(return_value="signed")
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.sign_secret_token", mock
    )
    return mock


@pytest.mark.asyncio
async def test_agenta_credential_requires_an_invocation_nonce(router, signer, allow):
    request = _mint_request()
    with pytest.raises(Exception, match="invocation credential"):
        await router.issue_agenta_credential(
            request=request,
            body=MCPAgentaCredentialRequest(tools=[]),
        )

    request.state.gateway_run_id = "run-1"
    response = await router.issue_agenta_credential(
        request=request,
        body=MCPAgentaCredentialRequest(
            tools=[_tool("read_config", _READ_CONFIG_CALL_REF)]
        ),
    )

    assert response.credentials == "Secret signed"
    assert signer.await_args.kwargs["gateway_run_id"] == "run-1"
    assert signer.await_args.kwargs["gateway_tools"][0]["name"] == "read_config"


@pytest.mark.asyncio
async def test_agenta_credential_refuses_a_caller_without_the_gateway_permission(
    router, signer, deny
):
    with pytest.raises(HTTPException) as refusal:
        await router.issue_agenta_credential(
            request=_mint_request(gateway_run_id="run-1"),
            body=MCPAgentaCredentialRequest(
                tools=[_tool("read_config", _READ_CONFIG_CALL_REF)]
            ),
        )

    assert refusal.value.status_code == 403
    assert deny.await_args.kwargs["permission"] == Permission.USE_MCP_ENDPOINTS
    assert signer.await_count == 0


@pytest.mark.asyncio
async def test_agenta_credential_confines_the_issued_value_to_the_gateway_audience(
    router, signer, allow
):
    await router.issue_agenta_credential(
        request=_mint_request(gateway_run_id="run-1"),
        body=MCPAgentaCredentialRequest(
            tools=[_tool("read_config", _READ_CONFIG_CALL_REF)]
        ),
    )

    assert signer.await_args.kwargs["audience"] == GATEWAY_TOKEN_AUDIENCE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call_ref",
    [
        "tools.agenta.not_a_registered_handler",
        "workflow.variant",
        "workflow.galaxy.support",
        "vault.read",
        "tools.composio.gmail.SEND_EMAIL",
    ],
)
async def test_agenta_credential_refuses_a_call_ref_outside_the_callback_catalog(
    router, signer, allow, call_ref
):
    with pytest.raises(HTTPException) as refusal:
        await router.issue_agenta_credential(
            request=_mint_request(gateway_run_id="run-1"),
            body=MCPAgentaCredentialRequest(tools=[_tool("anything", call_ref)]),
        )

    assert refusal.value.status_code == 403
    assert refusal.value.detail["code"] == "agenta_tool_not_entitled"
    assert refusal.value.detail["details"]["tools"] == [f"anything:{call_ref}"]
    assert signer.await_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call_ref",
    [
        _READ_CONFIG_CALL_REF,
        "gateway.search",
        "gateway.run",
        "workflow.variant.support",
        "workflow.variant.support.3",
        "workflow.environment.production.support",
        "tools.composio.gmail.SEND_EMAIL.work",
    ],
)
async def test_agenta_credential_signs_every_shape_the_tool_route_dispatches(
    router, signer, allow, call_ref
):
    await router.issue_agenta_credential(
        request=_mint_request(gateway_run_id="run-1"),
        body=MCPAgentaCredentialRequest(tools=[_tool("anything", call_ref)]),
    )

    assert signer.await_args.kwargs["gateway_tools"] == [
        _tool("anything", call_ref) | {"description": None}
    ]


@pytest.mark.asyncio
async def test_agenta_credential_refuses_widening_a_carried_tool_set(
    router, signer, allow
):
    with pytest.raises(HTTPException) as refusal:
        await router.issue_agenta_credential(
            request=_mint_request(
                gateway_run_id="run-1",
                gateway_tools=[
                    {"name": "read_config", "call_ref": _READ_CONFIG_CALL_REF}
                ],
            ),
            body=MCPAgentaCredentialRequest(
                tools=[
                    _tool("read_config", _READ_CONFIG_CALL_REF),
                    _tool("commit_revision", _COMMIT_REVISION_CALL_REF),
                ]
            ),
        )

    assert refusal.value.status_code == 403
    assert refusal.value.detail["code"] == "agenta_tool_not_entitled"
    assert refusal.value.detail["details"]["tools"] == [
        f"commit_revision:{_COMMIT_REVISION_CALL_REF}"
    ]
    assert signer.await_count == 0


@pytest.mark.asyncio
async def test_agenta_credential_refuses_renaming_a_carried_call_ref(
    router, signer, allow
):
    # The name is what the model reads when it picks a tool, so a rename reaches a tool
    # the carried set never offered under that name.
    with pytest.raises(HTTPException) as refusal:
        await router.issue_agenta_credential(
            request=_mint_request(
                gateway_run_id="run-1",
                gateway_tools=[
                    {"name": "read_config", "call_ref": _READ_CONFIG_CALL_REF}
                ],
            ),
            body=MCPAgentaCredentialRequest(
                tools=[_tool("commit_revision", _READ_CONFIG_CALL_REF)]
            ),
        )

    assert refusal.value.status_code == 403
    assert signer.await_count == 0


@pytest.mark.asyncio
async def test_agenta_credential_signs_a_subset_of_a_carried_tool_set(
    router, signer, allow
):
    await router.issue_agenta_credential(
        request=_mint_request(
            gateway_run_id="run-1",
            gateway_tools=[
                {"name": "read_config", "call_ref": _READ_CONFIG_CALL_REF},
                {"name": "commit_revision", "call_ref": _COMMIT_REVISION_CALL_REF},
            ],
        ),
        body=MCPAgentaCredentialRequest(
            tools=[_tool("read_config", _READ_CONFIG_CALL_REF)]
        ),
    )

    issued = signer.await_args.kwargs["gateway_tools"]
    assert [tool["call_ref"] for tool in issued] == [_READ_CONFIG_CALL_REF]


# ---------------------------------------------------------------------------
# Endpoint OAuth connection
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
    assert service.calls == ["fetch_endpoint", "cache_endpoint_discovery"]
    assert service.cached_oauth.scopes_offered == ["read", "write"]


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
# GET /connect/callback — exempt from the middleware, bound by the attempt record
# ---------------------------------------------------------------------------


@pytest.fixture
def session_user(monkeypatch):
    """Stand in for `resolve_session_user_id`, the browser's own Agenta session."""

    def _apply(user_id):
        async def _resolve(_request):
            return user_id

        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.resolve_session_user_id",
            _resolve,
        )

    return _apply


def _attempt(*, project_id, user_id, endpoint_id, state="opaque-handle"):
    """The record `claim()` hands back: the facts the callback is authorised against."""
    return MCPOAuthAttempt(
        id=uuid4(),
        state=state,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        issuer="https://auth.acme.example/",
        token_endpoint="https://auth.acme.example/token",
        redirect_uri="https://api.agenta.example/gateways/mcps/connect/callback",
        code_verifier="v" * 43,
        scopes=["read"],
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )


def _completion(*, project_id, user_id, endpoint_id, secret_id=None):
    return MCPOAuthCompletion(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        secret_id=secret_id or uuid4(),
    )


def test_callback_completes_and_puts_the_secret_id_onto_the_bound_endpoint(
    client, service, oauth_service, session_user, allow
):
    endpoint_id = uuid4()
    project_id, user_id = uuid4(), uuid4()
    secret_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    # The bound row the write returns. A binding that produced none is a failure now,
    # not a success card over a connection that names no grant (D20).
    service.edit_return = _oauth_endpoint(endpoint_id, secret_id=secret_id)
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    oauth_service.complete_return = _completion(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        secret_id=secret_id,
    )
    session_user(user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "opaque-handle"}
    )

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "mcp:oauth:connected" in response.text
    # The endpoint came from the record's bound id, not a query by server URL.
    assert service.calls == ["fetch_endpoint", "bind_endpoint_secret"]
    assert oauth_service.calls == [
        ("claim", "opaque-handle"),
        ("complete", "auth-code", "opaque-handle"),
    ]


def test_callback_from_a_different_user_writes_nothing(
    client, service, oauth_service, session_user, allow
):
    """OR41's attack: a hostile server replays the victim's handle with its own code.
    The record names the victim; the session behind the callback does not."""
    endpoint_id = uuid4()
    project_id, victim_id = uuid4(), uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=victim_id, endpoint_id=endpoint_id
    )
    session_user(uuid4())  # somebody else's browser

    response = client.get(
        "/connect/callback", params={"code": "hostile-code", "state": "opaque-handle"}
    )

    assert response.status_code == 400
    assert "different Agenta user" in response.text
    assert service.calls == []  # nothing read from, nothing written to the project


def test_callback_with_no_agenta_session_writes_nothing(
    client, service, oauth_service, session_user, allow
):
    endpoint_id = uuid4()
    project_id, user_id = uuid4(), uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    session_user(None)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "opaque-handle"}
    )

    assert response.status_code == 400
    assert service.calls == []


def test_callback_refuses_a_caller_who_lost_permission_on_the_project(
    client, service, oauth_service, session_user, deny
):
    endpoint_id = uuid4()
    project_id, user_id = uuid4(), uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    session_user(user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "opaque-handle"}
    )

    assert response.status_code == 403
    assert service.calls == []
    # The attempt was consumed, and the exchange that would have written a grant into
    # the project never ran.
    assert oauth_service.calls == [("claim", "opaque-handle")]


def test_callback_with_no_matching_endpoint_renders_a_failure_card(
    client, service, oauth_service, session_user, allow
):
    project_id, user_id = uuid4(), uuid4()
    endpoint_id = uuid4()
    service.fetch_return = None  # the bound endpoint is gone
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    oauth_service.complete_return = _completion(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    session_user(user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "opaque-handle"}
    )

    assert response.status_code == 400
    assert "No matching MCP endpoint" in response.text
    assert service.calls == ["fetch_endpoint"]  # no edit_endpoint call


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


def test_callback_with_a_replayed_state_renders_a_failure_card(
    client, service, oauth_service, session_user, allow
):
    """The second callback for one handle finds no record."""
    oauth_service.claim_raises = MCPOAuthStateInvalidError()
    session_user(uuid4())

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "already-used"}
    )

    assert response.status_code == 400
    assert "invalid or expired" in response.text.lower()
    assert service.calls == []


def test_connect_binds_the_attempt_to_the_endpoint_it_was_started_from(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)

    response = client.post(
        f"/endpoints/{endpoint_id}/connect", json={"scopes": ["read"]}
    )

    assert response.status_code == 200
    assert oauth_service.begun_endpoint_ids == [endpoint_id]


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
    # The row is read first, because the row is what says which grant to take with it.
    assert service.calls == ["fetch_endpoint", "delete_endpoint"]


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


# Grant methods are intentionally unavailable in this router contract.


# ---------------------------------------------------------------------------
# Disconnect
# ---------------------------------------------------------------------------


def test_disconnect_drops_this_connections_grant_and_clears_its_handle(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    connected = _oauth_endpoint(endpoint_id, secret_id=uuid4())
    service.fetch_return = connected
    service.edit_return = _oauth_endpoint(endpoint_id, secret_id=None)

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 200, response.text
    # The grant that went is this connection's, named by id rather than by the server
    # URL that its neighbours share.
    assert oauth_service.disconnected == [endpoint_id]
    # The handle is cleared by the two-column write, not by replacing the row (D3).
    assert "bind_endpoint_secret" in service.calls
    assert service.bound_secret_id is None
    assert "secret_id" not in response.json()["endpoint"]


def test_disconnect_leaves_the_connection_itself_in_place(
    client, service, oauth_service, allow
):
    """Disconnect is not delete. Every agent configured against this connection stays
    configured, and one Connect reconnects it."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())
    service.edit_return = _oauth_endpoint(endpoint_id, secret_id=None)

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 200, response.text
    assert "delete_endpoint" not in service.calls
    body = response.json()["endpoint"]
    assert body["id"] == str(endpoint_id)
    assert body["slug"] == "acme-notion"


def test_disconnect_clears_the_handle_even_when_no_grant_was_stored(
    client, service, oauth_service, allow
):
    """A `secret_id` pointing at nothing is the state that made an endpoint report
    itself ready and then fail every call."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())
    service.edit_return = _oauth_endpoint(endpoint_id, secret_id=None)
    oauth_service.disconnect_return = False

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 200, response.text
    # The handle is cleared by the two-column write, not by replacing the row (D3).
    assert "bind_endpoint_secret" in service.calls
    assert service.bound_secret_id is None
    assert "secret_id" not in response.json()["endpoint"]


def test_disconnect_missing_endpoint_404s(client, service, oauth_service, allow):
    service.fetch_return = None

    response = client.delete(f"/endpoints/{uuid4()}/connect")

    assert response.status_code == 404, response.text
    assert oauth_service.disconnected == []


def test_disconnect_rejects_a_non_oauth_endpoint(client, service, oauth_service, allow):
    endpoint_id = uuid4()
    service.fetch_return = _endpoint(endpoint_id)

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 400, response.text
    assert oauth_service.disconnected == []


def test_disconnect_denied_check_short_circuits_before_anything_is_dropped(
    client, service, oauth_service, deny
):
    response = client.delete(f"/endpoints/{uuid4()}/connect")

    assert response.status_code == 403, response.text
    assert service.calls == []
    assert oauth_service.disconnected == []


def test_deleting_an_endpoint_takes_its_grant_with_it(
    client, service, oauth_service, allow
):
    """Deleting the row alone left the grant in the vault with nothing naming it:
    unreachable, unlistable as a connection, and still holding a live token."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())

    response = client.delete(f"/endpoints/{endpoint_id}")

    assert response.status_code == 204, response.text
    assert oauth_service.disconnected == [endpoint_id]
    assert "delete_endpoint" in service.calls


def test_deleting_an_endpoint_with_no_oauth_grant_drops_nothing(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    service.fetch_return = _endpoint(endpoint_id)

    response = client.delete(f"/endpoints/{endpoint_id}")

    assert response.status_code == 204, response.text
    assert oauth_service.disconnected == []
    assert "delete_endpoint" in service.calls


def test_create_that_produced_no_record_is_not_reported_as_a_success(
    client, service, allow
):
    """The route used to answer `200 {"count": 0}`, which reads as "done" to every
    client and leaves nobody anything to act on. A create with no slug hit a not-null
    violation, the DAO's suppress decorator swallowed it, and this was the whole visible
    symptom."""
    service.create_return = None

    response = client.post(
        "/endpoints/",
        json={
            "endpoint": {
                "slug": "acme-notion",
                "auth_mode": "none",
                "data": {"route": {"base_url": _SERVER_URL}},
            }
        },
    )

    assert response.status_code == 500, response.text
    assert response.json() != {"count": 0}


def test_a_duplicate_display_name_is_refused_as_a_conflict(client, service, allow):
    """A name is what a harness renders in front of this server's tools, so two
    connections sharing one give the model no way to say which account it means."""
    from oss.src.core.gateways.mcps.types import MCPConnectionNameTakenError

    class _Refusing(MockMCPGatewayService):
        async def create_endpoint(self, *, project_id, user_id, endpoint):
            raise MCPConnectionNameTakenError(name="Acme", conflicting_slug="acme-work")

    refusing = _Refusing()
    router = MCPGatewayRouter(
        mcp_gateway_service=refusing,
        oauth_connect_service=MockMCPOAuthConnectService(),
        server_probe=None,
    )
    app = FastAPI()
    app.include_router(router.router)

    with TestClient(app, raise_server_exceptions=False) as refusing_client:
        response = refusing_client.post(
            "/endpoints/",
            json={
                "endpoint": {
                    "name": "Acme",
                    "auth_mode": "none",
                    "data": {"route": {"base_url": _SERVER_URL}},
                }
            },
        )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "mcp_connection_name_taken"
    assert "already uses this name" in detail["message"]


# URL inspection, before any row exists
# ---------------------------------------------------------------------------


class _RecordingProbe:
    def __init__(self, result: MCPServerProbeResult) -> None:
        self.result = result
        self.probed: list[str] = []

    async def probe(self, *, server_url: str) -> MCPServerProbeResult:
        self.probed.append(server_url)
        return self.result


@pytest.fixture(autouse=True)
def _secure_egress(monkeypatch):
    """The insecure-egress flag defaults ON, so the guard is pinned off explicitly —
    otherwise the http and localhost cases below would assert nothing."""
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)


@pytest.fixture
def probe():
    return _RecordingProbe(
        MCPServerProbeResult(
            reachable=True,
            server_name="Acme Tools",
            auth=MCPProbeAuth(mode=MCPProbeAuthMode.OAUTH),
        )
    )


@pytest.fixture
def probe_client(service, oauth_service, probe):
    router = MCPGatewayRouter(
        mcp_gateway_service=service,
        oauth_connect_service=oauth_service,
        server_probe=probe,
    )
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


def test_probe_reports_what_the_url_is(probe_client, probe, allow):
    response = probe_client.post("/endpoints/probe", json={"url": _SERVER_URL})

    assert response.status_code == 200, response.text
    assert probe.probed == [_SERVER_URL]
    body = response.json()
    assert body["count"] == 1
    assert body["probe"]["server_name"] == "Acme Tools"
    assert body["probe"]["auth"]["mode"] == "oauth"


def test_probe_is_not_read_as_an_endpoint_id(probe_client, probe, allow):
    """`/endpoints/probe` must beat `/endpoints/{endpoint_id}`, which wants a UUID."""
    response = probe_client.post("/endpoints/probe", json={"url": _SERVER_URL})

    assert response.status_code == 200, response.text


def test_probe_needs_permission_to_add_a_server(probe_client, probe, deny):
    response = probe_client.post("/endpoints/probe", json={"url": _SERVER_URL})

    assert response.status_code == 403
    assert probe.probed == []


def test_probe_creates_no_endpoint(probe_client, service, allow):
    probe_client.post("/endpoints/probe", json={"url": _SERVER_URL})

    assert service.calls == []


@pytest.mark.parametrize(
    "url",
    [
        "",
        "not-a-url",
        "ftp://mcp.acme.example/notion",
        "https://user:password@mcp.acme.example/notion",
        "http://localhost/mcp",
    ],
)
def test_probe_refuses_a_url_a_create_would_refuse(probe_client, probe, allow, url):
    """A URL the probe accepts must be one that can be saved, so the person is
    refused at the first step rather than the last."""
    response = probe_client.post("/endpoints/probe", json={"url": url})

    assert response.status_code == 400, response.text
    assert probe.probed == []


# ---------------------------------------------------------------------------
# D20: a credential write that produced no row is not a success
# ---------------------------------------------------------------------------


def test_disconnect_that_wrote_no_row_is_not_reported_as_a_disconnect(
    client, service, oauth_service, allow
):
    """The write refuses a credential the project does not own, and the refusal used to
    be swallowed into `None`. Answering `count=1` then says the authorization is gone
    while the connection still names it."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())
    service.edit_return = None

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 404, response.text


def test_a_callback_whose_binding_wrote_no_row_does_not_show_a_success_card(
    client, service, oauth_service, session_user, allow
):
    """The grant is written before the connection is pointed at it, so a binding that
    produced nothing leaves a person told they are connected over a connection that
    still reads as needing authorization."""
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)
    service.edit_return = None
    oauth_service.claim_return = _attempt(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    oauth_service.complete_return = _completion(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        secret_id=uuid4(),
    )
    session_user(user_id)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": "opaque-handle"}
    )

    assert response.status_code == 400, response.text
    assert '"success": false' in response.text
