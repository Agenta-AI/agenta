"""The MCP routes for a person's own sign-in to a project server (`owner_kind=user`).

A person who may run agents in the project signs in with their own OAuth account or their
own token. The project's server row is never written by them, and the project's connect
keeps its shipped behavior and permission.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
    MCPOAuthData,
)
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttemptOutcome,
    MCPOAuthAttemptStatus,
)
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.tests.pytest.unit.gateways.test_gateways_mcp_router import (
    FIXED_SCOPE,
    MockMCPGatewayService,
    MockMCPOAuthConnectService,
    _attempt,
    _completion,
)
from oss.tests.pytest.utils.principals import HumanCheckFromWrapper

_URL = "https://mcp.acme.example/notion"
PERSON = FIXED_SCOPE.user_id


def _server(auth_mode, *, discovered=True, endpoint_id=None, secret_id=None):
    return MCPEndpoint(
        id=endpoint_id or uuid4(),
        slug="acme-notion",
        auth_mode=auth_mode,
        secret_id=secret_id,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url=_URL),
            oauth=MCPOAuthData(
                authorization_server="https://auth.acme.example/",
                scopes_offered=["read", "write"],
            )
            if discovered
            else None,
        ),
    )


class _PersonOAuthService(MockMCPOAuthConnectService):
    def __init__(self):
        super().__init__()
        self.begun_owner_kinds = []
        self.tokens = []
        self.signed_out = []
        self.sign_ins_return = {}
        self.attempt_by_id = None
        self.completed_organizations = []

    async def begin(
        self,
        *,
        project_id,
        user_id,
        endpoint_id,
        server_url,
        scopes,
        oauth_config=None,
        owner_kind=SecretOwnerKind.PROJECT,
    ):
        self.begun_owner_kinds.append(owner_kind)
        return await super().begin(
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
            server_url=server_url,
            scopes=scopes,
            oauth_config=oauth_config,
        )

    async def sign_in_with_token(self, *, organization_id, user_id, endpoint, token):
        self.tokens.append((organization_id, user_id, endpoint.id, token))

    async def sign_out(self, *, organization_id, user_id, endpoint):
        self.signed_out.append((organization_id, user_id, endpoint.id))
        return True

    async def sign_ins(self, *, organization_id, user_id, endpoints):
        self.calls.append(("sign_ins", len(endpoints)))
        return self.sign_ins_return

    async def fetch_attempt(self, *, project_id, endpoint_id, attempt_id):  # noqa: ARG002
        return self.attempt_by_id

    async def complete(self, *, attempt, code, organization_id=None):
        self.completed_organizations.append(organization_id)
        return await super().complete(attempt=attempt, code=code)


@pytest.fixture
def oauth_service():
    return _PersonOAuthService()


@pytest.fixture
def service():
    return MockMCPGatewayService()


@pytest.fixture
def client(service, oauth_service):
    router = MCPGatewayRouter(
        mcp_gateway_service=service,
        oauth_connect_service=oauth_service,
        server_probe=None,
    )
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _scope(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )


def _access(monkeypatch, allowed: bool):
    mock = AsyncMock(return_value=allowed)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access", mock
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_access_service",
        lambda: HumanCheckFromWrapper(mock),
    )
    return mock


@pytest.fixture
def allow(monkeypatch):
    return _access(monkeypatch, True)


@pytest.fixture
def deny(monkeypatch):
    return _access(monkeypatch, False)


@pytest.fixture
def session_user(monkeypatch):
    def _apply(user_id):
        async def _resolve(_request):
            return user_id

        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.resolve_session_user_id",
            _resolve,
        )

    return _apply


@pytest.fixture
def person(monkeypatch):
    async def _require_person(_request):
        return FIXED_SCOPE.organization_id, PERSON

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.require_person", _require_person
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.personal_accounts_enabled",
        lambda: True,
    )


@pytest.fixture
def no_person(monkeypatch):
    async def _require_person(_request):
        raise HTTPException(
            status_code=403, detail={"code": "user_required", "message": "x"}
        )

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.require_person", _require_person
    )


@pytest.fixture
def switch_off(monkeypatch, person):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.personal_accounts_enabled",
        lambda: False,
    )


def _permissions(mock):
    return [call.kwargs["permission"] for call in mock.await_args_list]


def _connect(client, endpoint_id, body, owner_kind="user"):
    return client.post(
        f"/endpoints/{endpoint_id}/connect",
        params={"owner_kind": owner_kind},
        json=body,
    )


# --- connect, owner_kind=user ---------------------------------------------------- #


def test_a_person_begins_an_oauth_sign_in_with_the_run_permission(
    client, service, oauth_service, allow, person
):
    server = _server(MCPAuthScheme.OAUTH)
    service.fetch_return = server

    response = _connect(client, server.id, {"scopes": ["read"]})

    assert response.status_code == 200
    assert response.json()["redirect_url"].startswith("https://auth.acme.example/")
    assert oauth_service.begun_owner_kinds == [SecretOwnerKind.USER]
    assert _permissions(allow) == [Permission.RUN_SESSIONS]


def test_a_person_never_writes_the_server_row(
    client, service, oauth_service, allow, person
):
    """The scope step answers from the discovery the server already holds."""
    server = _server(MCPAuthScheme.OAUTH)
    service.fetch_return = server

    response = _connect(client, server.id, {})

    assert response.status_code == 200
    assert response.json()["scopes_offered"] == ["read", "write"]
    assert "cache_endpoint_discovery" not in service.calls
    assert not any(call[0] == "discover" for call in oauth_service.calls)


def test_an_undiscovered_server_answers_409_server_not_discovered(
    client, service, oauth_service, allow, person
):
    server = _server(MCPAuthScheme.OAUTH, discovered=False)
    service.fetch_return = server

    response = _connect(client, server.id, {"scopes": ["read"]})

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "server_not_discovered",
        "message": "A project admin must connect this server once first.",
    }
    assert oauth_service.begun_owner_kinds == []


def test_a_person_signs_in_to_a_token_server_with_a_token(
    client, service, oauth_service, allow, person
):
    server = _server(MCPAuthScheme.API_KEY)
    service.fetch_return = server

    response = _connect(client, server.id, {"token": "tk-secret"})

    assert response.status_code == 200
    assert response.json() == {"count": 1, "scopes_offered": []}
    assert oauth_service.tokens == [
        (FIXED_SCOPE.organization_id, PERSON, server.id, "tk-secret")
    ]
    assert "tk-secret" not in response.text


def test_a_token_server_needs_a_token(client, service, oauth_service, allow, person):
    server = _server(MCPAuthScheme.API_KEY)
    service.fetch_return = server

    response = _connect(client, server.id, {})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "token_required"


def test_an_oauth_server_refuses_a_token(client, service, oauth_service, allow, person):
    server = _server(MCPAuthScheme.OAUTH)
    service.fetch_return = server

    response = _connect(client, server.id, {"token": "tk"})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "token_not_expected"
    assert oauth_service.tokens == []


def test_a_caller_who_is_no_person_cannot_sign_in(
    client, service, oauth_service, allow, no_person
):
    server = _server(MCPAuthScheme.API_KEY)
    service.fetch_return = server

    response = _connect(client, server.id, {"token": "tk"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "user_required"
    assert oauth_service.tokens == []


def test_the_switch_off_refuses_a_person_sign_in(
    client, service, oauth_service, allow, switch_off
):
    server = _server(MCPAuthScheme.API_KEY)
    service.fetch_return = server

    response = _connect(client, server.id, {"token": "tk"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "personal_accounts_disabled"


def test_a_person_who_may_not_run_agents_cannot_sign_in(
    client, service, oauth_service, deny, person
):
    server = _server(MCPAuthScheme.API_KEY)
    service.fetch_return = server

    response = _connect(client, server.id, {"token": "tk"})

    assert response.status_code == 403
    assert oauth_service.tokens == []


def test_the_project_connect_keeps_the_edit_permission(
    client, service, oauth_service, allow
):
    server = _server(MCPAuthScheme.OAUTH)
    service.fetch_return = server

    response = _connect(client, server.id, {"scopes": ["read"]}, owner_kind="project")

    assert response.status_code == 200
    assert oauth_service.begun_owner_kinds == [SecretOwnerKind.PROJECT]
    assert _permissions(allow) == [Permission.EDIT_MCP_ENDPOINTS]


def test_the_project_connect_still_refuses_a_token_server(
    client, service, oauth_service, allow
):
    service.fetch_return = _server(MCPAuthScheme.API_KEY)

    response = _connect(
        client, service.fetch_return.id, {"token": "tk"}, owner_kind="project"
    )

    assert response.status_code == 400
    assert oauth_service.tokens == []


# --- disconnect, owner_kind=user ------------------------------------------------- #


def test_a_person_signs_out_of_their_own_sign_in(
    client, service, oauth_service, allow, person
):
    server = _server(MCPAuthScheme.OAUTH, secret_id=uuid4())
    service.fetch_return = server

    response = client.delete(
        f"/endpoints/{server.id}/connect", params={"owner_kind": "user"}
    )

    assert response.status_code == 200
    assert oauth_service.signed_out == [
        (FIXED_SCOPE.organization_id, PERSON, server.id)
    ]
    # The project's grant is not the person's to drop.
    assert oauth_service.disconnected == []
    assert _permissions(allow) == [Permission.RUN_SESSIONS]


# --- attempts -------------------------------------------------------------------- #


def _person_attempt(endpoint_id, *, user_id=PERSON):
    return _attempt(
        project_id=FIXED_SCOPE.project_id, user_id=user_id, endpoint_id=endpoint_id
    ).model_copy(update={"owner_kind": SecretOwnerKind.USER})


def test_a_person_may_follow_their_own_sign_in_attempt(
    client, oauth_service, monkeypatch, person
):
    endpoint_id = uuid4()
    attempt = _person_attempt(endpoint_id)
    oauth_service.attempt_by_id = attempt
    oauth_service.outcome_return = MCPOAuthAttemptOutcome(
        id=attempt.id, status=MCPOAuthAttemptStatus.PENDING
    )

    async def check(*, user_uid, project_id, permission):
        return permission == Permission.RUN_SESSIONS

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access", check
    )

    fetched = client.get(f"/endpoints/{endpoint_id}/connect/attempts/{attempt.id}")
    cancelled = client.delete(f"/endpoints/{endpoint_id}/connect/attempts/{attempt.id}")

    assert fetched.status_code == 200
    assert cancelled.status_code == 204
    assert oauth_service.cancelled == [(endpoint_id, attempt.id)]


def test_a_person_may_not_follow_someone_elses_attempt(
    client, oauth_service, monkeypatch, person
):
    endpoint_id = uuid4()
    attempt = _person_attempt(endpoint_id, user_id=uuid4())
    oauth_service.attempt_by_id = attempt

    async def check(*, user_uid, project_id, permission):
        return permission == Permission.RUN_SESSIONS

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access", check
    )

    response = client.get(f"/endpoints/{endpoint_id}/connect/attempts/{attempt.id}")

    assert response.status_code == 403


# --- callback -------------------------------------------------------------------- #


class _Access(HumanCheckFromWrapper):
    async def project_organization_id(self, *, project_id):
        return FIXED_SCOPE.organization_id


def test_a_person_callback_checks_the_run_permission_and_writes_their_grant(
    client, oauth_service, session_user, monkeypatch
):
    endpoint_id = uuid4()
    attempt = _person_attempt(endpoint_id)
    oauth_service.claim_return = attempt
    oauth_service.complete_return = _completion(
        project_id=attempt.project_id, user_id=PERSON, endpoint_id=endpoint_id
    )
    session_user(PERSON)
    seen = []

    async def check(*, user_uid, project_id, permission):
        seen.append(permission)
        return permission == Permission.RUN_SESSIONS

    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_access_service",
        lambda: _Access(check),
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.personal_accounts_enabled",
        lambda: True,
    )

    response = client.get(
        "/connect/callback", params={"code": "c", "state": attempt.state}
    )

    assert response.status_code == 200
    assert "mcp:oauth:connected" in response.text
    assert seen == [Permission.RUN_SESSIONS]
    assert oauth_service.completed_organizations == [FIXED_SCOPE.organization_id]


# --- user_sign_in on the endpoint responses --------------------------------------- #


def test_the_list_says_the_callers_own_sign_in_per_server(
    client, service, oauth_service, allow, person
):
    signed, unsigned = _server(MCPAuthScheme.OAUTH), _server(MCPAuthScheme.API_KEY)
    open_server = _server(MCPAuthScheme.NONE)
    service.list_return = [signed, unsigned, open_server]
    oauth_service.sign_ins_return = {signed.id: True}

    endpoints = client.get("/endpoints/").json()["endpoints"]

    assert endpoints[0]["user_sign_in"] == {"is_ready": True}
    # Present and null: the caller has no sign-in row for this server.
    assert "user_sign_in" in endpoints[1] and endpoints[1]["user_sign_in"] is None
    # A server that takes no sign-in has no such field.
    assert "user_sign_in" not in endpoints[2]
    # One read for the whole list.
    assert [c for c in oauth_service.calls if c[0] == "sign_ins"] == [("sign_ins", 3)]


def test_query_and_fetch_say_the_callers_sign_in(
    client, service, oauth_service, allow, person
):
    server = _server(MCPAuthScheme.OAUTH)
    service.query_return = [server]
    service.fetch_return = server
    oauth_service.sign_ins_return = {server.id: False}

    queried = client.post("/endpoints/query", json={}).json()["endpoints"][0]
    fetched = client.get(f"/endpoints/{server.id}").json()["endpoint"]

    assert queried["user_sign_in"] == {"is_ready": False}
    assert fetched["user_sign_in"] == {"is_ready": False}


def test_no_person_gets_no_sign_in_field_and_no_read(
    client, service, oauth_service, allow, no_person
):
    service.list_return = [_server(MCPAuthScheme.OAUTH)]

    endpoints = client.get("/endpoints/").json()["endpoints"]

    assert "user_sign_in" not in endpoints[0]
    assert not any(c[0] == "sign_ins" for c in oauth_service.calls)


def test_the_switch_off_leaves_the_field_out(
    client, service, oauth_service, allow, switch_off
):
    service.list_return = [_server(MCPAuthScheme.OAUTH)]

    endpoints = client.get("/endpoints/").json()["endpoints"]

    assert "user_sign_in" not in endpoints[0]
    assert not any(c[0] == "sign_ins" for c in oauth_service.calls)
