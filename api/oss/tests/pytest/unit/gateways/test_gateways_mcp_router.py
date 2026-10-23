"""MCP gateway router tests.

TestClient + a hand-written mock `MCPGatewayService` + a monkeypatched
`get_auth_scope()`/`check_action_access()` — no real database, no real service.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.tests.pytest.utils.principals import make_envelope
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
    MCPOAuthConfig,
)
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptOutcome,
    MCPOAuthAttemptStatus,
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthDiscoveryError
from oss.src.core.gateways.mcps.types import MCPConnectionChangedError
from oss.src.core.gateways.mcps.probe import (
    MCPProbeAuth,
    MCPProbeAuthMode,
    MCPServerProbeResult,
)
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthAttemptCancelledError,
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
    ("/endpoints/{endpoint_id}/check", "POST"): "record_mcp_endpoint_check",
    ("/endpoints/{endpoint_id}/connect", "POST"): "connect_mcp_endpoint",
    ("/endpoints/{endpoint_id}/connect", "DELETE"): "disconnect_mcp_endpoint",
    (
        "/endpoints/{endpoint_id}/connect/attempts/{attempt_id}",
        "GET",
    ): "fetch_mcp_connect_attempt",
    (
        "/endpoints/{endpoint_id}/connect/attempts/{attempt_id}",
        "DELETE",
    ): "cancel_mcp_connect_attempt",
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


def _oauth_endpoint(endpoint_id, *, secret_id=None, oauth_config=None) -> MCPEndpoint:
    return MCPEndpoint(
        id=endpoint_id,
        slug="acme-notion",
        auth_mode=MCPAuthScheme.OAUTH,
        secret_id=secret_id,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url=_SERVER_URL), oauth_config=oauth_config
        ),
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
        self.delete_raises = None
        self.url_secret_return = "test-key-one"

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

    async def record_endpoint_check(
        self, *, project_id, user_id, endpoint_id, ok, reason=None
    ):
        self.calls.append("record_endpoint_check")
        self.recorded_check = (ok, reason)
        return self.edit_return

    async def bind_endpoint_secret(
        self, *, project_id, user_id, endpoint_id, secret_id
    ):
        # Records the handle it was given: a credential transition writes two columns,
        # so what a caller supplies is the whole of what it can change (D3).
        self.calls.append("bind_endpoint_secret")
        self.bound_secret_id = secret_id
        return self.edit_return

    async def delete_endpoint(self, *, project_id, endpoint_id, pending_auth_mode=None):
        self.calls.append("delete_endpoint")
        self.pending_auth_mode = pending_auth_mode
        if self.delete_raises is not None:
            raise self.delete_raises
        return self.delete_return

    async def probe_secret_value(self, *, scope, secret_id):
        self.calls.append("probe_secret_value")
        return self.url_secret_return


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
            attempt_id=uuid4(),
            expires_in=600,
        )
        self.claim_return = None
        self.claim_raises = None
        self.complete_return = None
        self.complete_raises = None
        self.begun_endpoint_ids = []
        self.begun_oauth_configs = []
        self.disconnect_return = True
        # Which connection each disconnect named. A disconnect that dropped the
        # neighbour's grant would be invisible without this.
        self.disconnected = []
        # How each attempt ended, as the callback recorded it for the browser.
        self.settled = []
        self.cancelled = []
        self.outcome_return = None

    async def discover(self, *, server_url):
        self.calls.append(("discover", server_url))
        if self.discover_raises:
            raise self.discover_raises
        return self.discover_return

    async def begin(
        self, *, project_id, user_id, endpoint_id, server_url, scopes, oauth_config=None
    ):
        self.calls.append(("begin", server_url, tuple(scopes)))
        self.begun_oauth_configs.append(oauth_config)
        self.begun_endpoint_ids.append(endpoint_id)
        return self.begin_return

    async def lookup(self, *, state):
        # The record the handle names, which is the one `claim()` hands back.
        attempt = self.claim_return
        return attempt if attempt is not None and attempt.state == state else None

    async def settle(self, *, attempt, status, error=None):
        self.settled.append((attempt.id, status, error))

    async def cancel(self, *, project_id, endpoint_id, attempt_id=None):
        self.cancelled.append((endpoint_id, attempt_id))
        return 1

    async def outcome(self, *, project_id, endpoint_id, attempt_id):
        return self.outcome_return

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

    async def disconnect(self, *, project_id, user_id, endpoint_id):
        # The service decides on the row it reads under the lock and answers with it:
        # `None` for no row, the row unchanged when it is not an OAuth connection.
        self.calls.append(("disconnect", endpoint_id))
        self.disconnected.append(endpoint_id)
        if self.disconnect_return is True:
            return _oauth_endpoint(endpoint_id, secret_id=None)
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
    state.setdefault("run_envelope", make_envelope(run_id="run-1"))
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


def test_connect_begins_as_the_client_saved_on_the_connection(
    client, service, oauth_service, allow
):
    endpoint_id = uuid4()
    config = MCPOAuthConfig(client_id="app-from-github")
    service.fetch_return = _oauth_endpoint(endpoint_id, oauth_config=config)

    response = client.post(
        f"/endpoints/{endpoint_id}/connect", json={"scopes": ["read"]}
    )

    assert response.status_code == 200
    assert oauth_service.begun_oauth_configs == [config]


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
    # The service checks, writes and binds under the attempt's lock; the router only
    # authorises the caller and renders the page.
    assert service.calls == []
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


def _ready_callback(service, oauth_service, session_user, *, endpoint=None):
    """A callback whose attempt, session and endpoint all line up, so one test can
    change the one fact it is about."""
    endpoint_id = uuid4()
    project_id, user_id, secret_id = uuid4(), uuid4(), uuid4()
    service.fetch_return = endpoint or _oauth_endpoint(endpoint_id)
    service.edit_return = _oauth_endpoint(endpoint_id, secret_id=secret_id)
    attempt = _attempt(project_id=project_id, user_id=user_id, endpoint_id=endpoint_id)
    oauth_service.claim_return = attempt
    oauth_service.complete_return = _completion(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        secret_id=secret_id,
    )
    session_user(user_id)
    return attempt


def _names_the_attempt(page: str, attempt: MCPOAuthAttempt) -> bool:
    return (
        f'"endpoint_id": "{attempt.endpoint_id}"' in page
        and f'"attempt_id": "{attempt.id}"' in page
    )


def test_a_provider_error_page_names_the_attempt_and_carries_the_providers_words(
    client, service, oauth_service, session_user, allow
):
    attempt = _ready_callback(service, oauth_service, session_user)

    response = client.get(
        "/connect/callback",
        params={
            "state": attempt.state,
            "error": "access_denied",
            "error_description": "User declined",
        },
    )

    assert response.status_code == 400
    assert _names_the_attempt(response.text, attempt)
    assert "User declined" in response.text
    # Claimed first, by the browser that started it, then recorded for the sheet in
    # case this page's message never reaches it. No code was exchanged.
    assert oauth_service.calls == [("claim", attempt.state)]
    assert oauth_service.settled == [
        (attempt.id, MCPOAuthAttemptStatus.FAILED, "User declined")
    ]


@pytest.mark.parametrize("caller", ["nobody", "somebody else"])
def test_an_error_callback_from_a_caller_who_cannot_claim_changes_nothing(
    client, service, oauth_service, session_user, allow, caller
):
    """Anyone holding `state`, the authorization server included, could otherwise end
    the person's attempt for them."""
    attempt = _ready_callback(service, oauth_service, session_user)
    session_user(None if caller == "nobody" else uuid4())

    response = client.get(
        "/connect/callback",
        params={"state": attempt.state, "error": "access_denied"},
    )

    assert response.status_code == 400
    assert "access_denied" in response.text
    assert oauth_service.settled == []


def test_a_cancelled_sign_in_shows_the_cancel_and_writes_nothing(
    client, service, oauth_service, session_user, allow
):
    attempt = _ready_callback(service, oauth_service, session_user)
    oauth_service.complete_raises = MCPOAuthAttemptCancelledError()

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": attempt.state}
    )

    assert response.status_code == 400
    assert "This sign-in was cancelled." in response.text
    assert _names_the_attempt(response.text, attempt)
    assert service.calls == []


def test_a_page_with_no_code_names_the_attempt(
    client, service, oauth_service, session_user, allow
):
    attempt = _ready_callback(service, oauth_service, session_user)

    response = client.get("/connect/callback", params={"state": attempt.state})

    assert response.status_code == 400
    assert _names_the_attempt(response.text, attempt)
    assert "Missing authorization code." in response.text


def test_a_refused_claim_still_names_the_attempt(
    client, service, oauth_service, session_user, allow
):
    """A browser with no Agenta session is told so on the sheet, not as a closed window."""
    attempt = _ready_callback(service, oauth_service, session_user)
    session_user(None)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": attempt.state}
    )

    assert response.status_code == 400
    assert _names_the_attempt(response.text, attempt)
    assert "different Agenta user" in response.text


def test_a_successful_page_names_the_attempt(
    client, service, oauth_service, session_user, allow
):
    attempt = _ready_callback(service, oauth_service, session_user)

    response = client.get(
        "/connect/callback", params={"code": "auth-code", "state": attempt.state}
    )

    assert response.status_code == 200
    assert _names_the_attempt(response.text, attempt)


def test_connect_returns_the_attempt_and_its_ttl(client, service, oauth_service, allow):
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id)

    response = client.post(
        f"/endpoints/{endpoint_id}/connect", json={"scopes": ["read"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["attempt_id"] == str(oauth_service.begin_return.attempt_id)
    assert body["expires_in"] == oauth_service.begin_return.expires_in


def test_cancel_attempt_cancels_only_the_attempt_named(client, oauth_service, allow):
    endpoint_id, attempt_id = uuid4(), uuid4()

    response = client.delete(f"/endpoints/{endpoint_id}/connect/attempts/{attempt_id}")

    assert response.status_code == 204
    assert oauth_service.cancelled == [(endpoint_id, attempt_id)]


def test_fetch_attempt_reports_how_it_ended(client, oauth_service, allow):
    endpoint_id, attempt_id = uuid4(), uuid4()
    oauth_service.outcome_return = MCPOAuthAttemptOutcome(
        id=attempt_id, status=MCPOAuthAttemptStatus.FAILED, error="User declined"
    )

    response = client.get(f"/endpoints/{endpoint_id}/connect/attempts/{attempt_id}")

    assert response.status_code == 200
    assert response.json()["attempt"] == {
        "id": str(attempt_id),
        "status": "failed",
        "error": "User declined",
    }


def test_fetch_attempt_answers_404_for_an_attempt_it_does_not_know(
    client, oauth_service, allow
):
    response = client.get(f"/endpoints/{uuid4()}/connect/attempts/{uuid4()}")

    assert response.status_code == 404


@pytest.mark.parametrize("method", ["GET", "DELETE"])
def test_the_attempt_routes_need_the_edit_permission(
    client, oauth_service, deny, method
):
    response = client.request(
        method, f"/endpoints/{uuid4()}/connect/attempts/{uuid4()}"
    )

    assert response.status_code == 403
    assert oauth_service.cancelled == []


def _edit(client, endpoint_id, *, auth_mode, base_url=_SERVER_URL):
    return client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": str(endpoint_id),
                "auth_mode": auth_mode,
                "data": {"route": {"base_url": base_url}},
            }
        },
    )


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
    # The service takes the connection's grant with it, under the connection's lock.
    assert service.calls == ["delete_endpoint"]


def test_a_pending_delete_of_a_row_another_tab_took_over_is_refused(
    client, service, allow
):
    service.delete_raises = MCPConnectionChangedError()

    response = client.delete(
        f"/endpoints/{uuid4()}", params={"pending_auth_mode": "oauth"}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "mcp_connection_changed"
    assert service.pending_auth_mode == "oauth"


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
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 200, response.text
    # The grant that went is this connection's, named by id rather than by the server
    # URL that its neighbours share.
    assert oauth_service.disconnected == [endpoint_id]
    assert "secret_id" not in response.json()["endpoint"]


def test_disconnect_leaves_the_connection_itself_in_place(
    client, service, oauth_service, allow
):
    """Disconnect is not delete. Every agent configured against this connection stays
    configured, and one Connect reconnects it."""
    endpoint_id = uuid4()
    service.fetch_return = _oauth_endpoint(endpoint_id, secret_id=uuid4())

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 200, response.text
    assert "delete_endpoint" not in service.calls
    body = response.json()["endpoint"]
    assert body["id"] == str(endpoint_id)
    assert body["slug"] == "acme-notion"


def test_disconnect_missing_endpoint_404s(client, service, oauth_service, allow):
    oauth_service.disconnect_return = None

    response = client.delete(f"/endpoints/{uuid4()}/connect")

    assert response.status_code == 404, response.text


def test_disconnect_rejects_a_non_oauth_endpoint(client, service, oauth_service, allow):
    endpoint_id = uuid4()
    oauth_service.disconnect_return = _endpoint(endpoint_id)

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 400, response.text
    # Nothing was changed: the service answered with the row as it found it.
    assert service.calls == []


def test_disconnect_denied_check_short_circuits_before_anything_is_dropped(
    client, service, oauth_service, deny
):
    response = client.delete(f"/endpoints/{uuid4()}/connect")

    assert response.status_code == 403, response.text
    assert service.calls == []
    assert oauth_service.disconnected == []


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


def _real_service_client(dao):
    """The create and rename routes over the REAL `MCPGatewayService`.

    Every other case in this file stubs the service, which proves how a refusal is
    rendered and nothing about whether the route ever asks for one. The duplicate-name
    refusal was reported as missing from the create path on that evidence alone, so the
    wiring gets a case of its own: router, service and the name check, with only
    persistence replaced.
    """
    from unittest.mock import AsyncMock

    from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
    from oss.src.core.gateways.mcps.service import MCPGatewayService
    from oss.src.core.gateways.policy.service import GatewayPolicyService
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
        MockConnectionsService,
    )

    service = MCPGatewayService(
        mcp_endpoints_dao=dao,
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=AsyncMock(),
        upstream_registry=MCPUpstreamRegistry(adapters={}),
        connections_service=MockConnectionsService(),
    )
    router = MCPGatewayRouter(
        mcp_gateway_service=service,
        oauth_connect_service=MockMCPOAuthConnectService(),
        server_probe=None,
    )
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


def _post_connection(client, name):
    return client.post(
        "/endpoints/",
        json={
            "endpoint": {
                "name": name,
                "auth_mode": "none",
                "data": {"route": {"base_url": _SERVER_URL}},
            }
        },
    )


def test_the_create_route_reaches_the_name_check(allow):
    """Both spellings of a taken name, refused by the route a connection is made through.

    "Acme-Notion" is the case the comparison exists for: a different string, and the
    same `mcp__Acme_Notion__<tool>` in front of the model.
    """
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
        MockMCPEndpointsDAO,
    )

    dao = MockMCPEndpointsDAO()
    client = _real_service_client(dao)

    first = _post_connection(client, "Acme Notion")
    assert first.status_code == 200, first.text

    for taken in ("Acme Notion", "Acme-Notion", "  Acme Notion  "):
        refused = _post_connection(client, taken)
        assert refused.status_code == 409, f"{taken}: {refused.text}"
        assert refused.json()["detail"]["code"] == "mcp_connection_name_taken"

    # The connection that held the name is the one still holding it, unedited.
    assert [row.name for row in dao._by_id.values()] == ["Acme Notion"]


def test_the_rename_route_reaches_the_name_check(allow):
    """A rename is where a name can stop being free, so the route that performs one
    asks the same question the create route asks."""
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
        MockMCPEndpointsDAO,
    )

    dao = MockMCPEndpointsDAO()
    client = _real_service_client(dao)

    assert _post_connection(client, "Acme Notion").status_code == 200
    second = _post_connection(client, "Acme Linear")
    assert second.status_code == 200, second.text
    second_id = second.json()["endpoint"]["id"]

    for taken in ("Acme Notion", "Acme-Notion"):
        refused = client.put(
            f"/endpoints/{second_id}",
            json={
                "endpoint": {
                    "id": second_id,
                    "name": taken,
                    "auth_mode": "none",
                    "data": {"route": {"base_url": _SERVER_URL}},
                }
            },
        )
        assert refused.status_code == 409, f"{taken}: {refused.text}"
        assert refused.json()["detail"]["code"] == "mcp_connection_name_taken"

    assert sorted(row.name for row in dao._by_id.values()) == [
        "Acme Linear",
        "Acme Notion",
    ]


# URL inspection, before any row exists
# ---------------------------------------------------------------------------


class _RecordingProbe:
    def __init__(self, result: MCPServerProbeResult) -> None:
        self.result = result
        self.probed: list[str] = []
        self.secrets: list[str | None] = []
        self.bindings: list = []

    async def probe(
        self, *, server_url: str, secret: str | None = None, binding=None
    ) -> MCPServerProbeResult:
        self.probed.append(server_url)
        self.secrets.append(secret)
        self.bindings.append(binding)
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
    # The connect sheet shows this sentence to a person, so it names the field by the
    # sheet's label, not by a path in a body the probe does not take.
    assert "endpoint.data.route" not in response.json()["detail"]
    assert response.json()["detail"].startswith("Server URL")


_PLACEHOLDER_URL = "https://mcp.acme.example/{secret}/v2/mcp"


def test_a_placeholder_url_is_probed_with_the_value_of_the_named_secret(
    probe_client, probe, service, allow
):
    """The browser names the secret; the API reads its value and hands it to the probe,
    which is given the stored address, placeholder and all."""
    response = probe_client.post(
        "/endpoints/probe",
        json={"url": _PLACEHOLDER_URL, "secret_id": str(uuid4())},
    )

    assert response.status_code == 200, response.text
    assert probe.probed == [_PLACEHOLDER_URL]
    assert probe.secrets == ["test-key-one"]
    assert probe.bindings[0].kind == "url"
    assert "test-key-one" not in response.text


def test_a_key_is_probed_where_its_binding_sends_it(probe_client, probe, allow):
    """A changed key is checked before a connection saves it, sent the way the relay
    will send it."""
    response = probe_client.post(
        "/endpoints/probe",
        json={
            "url": _SERVER_URL,
            "secret_id": str(uuid4()),
            "credential_binding": {"kind": "header", "name": "X-Api-Key"},
        },
    )

    assert response.status_code == 200, response.text
    assert probe.secrets == ["test-key-one"]
    assert probe.bindings[0].name == "X-Api-Key"


@pytest.mark.parametrize(
    ("url", "with_secret"),
    [
        # A placeholder address cannot be probed anonymously.
        (_PLACEHOLDER_URL, False),
        # And a secret with no binding is sent only to fill a placeholder.
        (_SERVER_URL, True),
    ],
)
def test_a_secret_and_a_placeholder_come_together(
    probe_client, probe, allow, url, with_secret
):
    body = {"url": url, **({"secret_id": str(uuid4())} if with_secret else {})}

    response = probe_client.post("/endpoints/probe", json=body)

    assert response.status_code == 400, response.text
    assert "{secret}" in response.json()["detail"]
    assert probe.probed == []


def test_a_secret_with_no_single_value_is_refused(probe_client, probe, service, allow):
    service.url_secret_return = None

    response = probe_client.post(
        "/endpoints/probe",
        json={"url": _PLACEHOLDER_URL, "secret_id": str(uuid4())},
    )

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
    oauth_service.disconnect_return = None

    response = client.delete(f"/endpoints/{endpoint_id}/connect")

    assert response.status_code == 404, response.text


def test_a_check_is_recorded_and_the_endpoint_returned(client, service, allow):
    endpoint_id = uuid4()
    service.edit_return = _endpoint(endpoint_id)

    response = client.post(
        f"/endpoints/{endpoint_id}/check",
        json={"ok": False, "reason": "The server did not accept that credential."},
    )

    assert response.status_code == 200
    assert response.json()["endpoint"]["id"] == str(endpoint_id)
    assert service.recorded_check == (
        False,
        "The server did not accept that credential.",
    )


def test_a_long_check_reason_is_cut_rather_than_refused(client, service, allow):
    endpoint_id = uuid4()
    service.edit_return = _endpoint(endpoint_id)

    response = client.post(
        f"/endpoints/{endpoint_id}/check",
        json={"ok": False, "reason": "x" * 1000},
    )

    assert response.status_code == 200
    assert service.recorded_check == (False, "x" * 300)


def test_a_check_on_a_missing_endpoint_is_not_found(client, service, allow):
    service.edit_return = None

    response = client.post(f"/endpoints/{uuid4()}/check", json={"ok": True})

    assert response.status_code == 404


def test_recording_a_check_needs_the_edit_permission(client, service, deny):
    response = client.post(f"/endpoints/{uuid4()}/check", json={"ok": True})

    assert response.status_code == 403
    assert "record_endpoint_check" not in service.calls


def test_a_refused_base_url_does_not_echo_the_bound_key(client):
    """A base_url that still holds the bound query parameter is refused without echoing it."""
    canary = "qa-canary-key-0123456789"

    response = client.post(
        "/endpoints/",
        json={
            "endpoint": {
                "name": "Acme",
                "auth_mode": "api_key",
                "data": {
                    "route": {
                        "base_url": f"{_SERVER_URL}?api_key={canary}&other=1",
                        "credential_binding": {"kind": "query", "name": "api_key"},
                    }
                },
            }
        },
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert canary not in response.text


@pytest.mark.asyncio
async def test_mcp_mint_copies_the_run_envelope(router, signer, allow):
    envelope = make_envelope(run_id="run-1")
    request = _mint_request(gateway_run_id="run-1", run_envelope=envelope)
    await router.issue_agenta_credential(
        request=request,
        body=MCPAgentaCredentialRequest(
            tools=[_tool("read_config", _READ_CONFIG_CALL_REF)]
        ),
    )
    assert signer.await_args.kwargs["envelope"] == envelope
