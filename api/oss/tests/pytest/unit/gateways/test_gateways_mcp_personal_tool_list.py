"""The tool list of a "user" MCP item, read in the browser with the viewer's own sign-in.

The server view mints a gateway credential with `item_keys`, as the access exchange does
for a playground turn, then relays `tools/list` with `account_source=user`. The account
resolves for the person of the authenticated session, never for a person, a project or an
organization the request names. These tests drive the real exchange, the real token
signing and verification, and the real relay; only the account read, the access decision
and the upstream are faked.
"""

import json
from contextlib import contextmanager
from typing import Dict, List
from uuid import UUID, uuid4

import pytest
from jwt import decode
from starlette.requests import Request

import oss.src.apis.fastapi.access.router as access_router_module
import oss.src.apis.fastapi.gateways.credentials_router as credentials_router
import oss.src.core.account_choices.service as account_choices_module
from oss.src.apis.fastapi.access.router import AccessRouter
from oss.src.apis.fastapi.gateways.credentials_router import (
    GatewayCredentialsRequest,
    GatewayCredentialsRouter,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import Decision, DecisionReason
from oss.src.core.account_choices.dtos import ItemAccount
from oss.src.core.gateways.mcps.dtos import MCPCallContext
from oss.src.core.gateways.mcps.types import MCPAuthRequiredError, MCPSignInMissingError
from oss.src.core.gateways.policy.dtos import BoundSecretRef, SecretOwnerKind
from oss.src.middlewares import auth
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)
from oss.src.utils.env import env
from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
    MockMCPEndpointsDAO,
    MockUpstreamAdapter,
    _relay_service,
)
from oss.tests.pytest.unit.gateways.test_gateways_mcp_user_sign_in_relay import (
    ITEM_KEY,
    SLUG,
    _person_grant,
    _RecordingResolver,
    _server,
)
from oss.tests.pytest.utils.principals import (
    AllowingAccessService,
    envelope_for_claims,
    make_request_access,
)

SECRET_KEY = "unit-test-secret-key-with-32-bytes"


class _Accounts:
    """The account read: each person's own sign-in by person, as the SQL scopes it."""

    def __init__(self, sign_ins: Dict[UUID, UUID]):
        self.sign_ins = sign_ins
        self.calls: List[dict] = []

    async def resolve(
        self, *, organization_id, project_id, artifact_id, user_id, items
    ):
        self.calls.append(
            {
                "organization_id": organization_id,
                "project_id": project_id,
                "artifact_id": artifact_id,
                "user_id": user_id,
                "items": items,
            }
        )
        secret_id = self.sign_ins.get(user_id)
        return [
            ItemAccount(
                item_key=item.item_key,
                secret_id=secret_id,
                is_ready=secret_id is not None,
            )
            for item in items
        ]


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)
    monkeypatch.setattr(env.agenta.access, "personal_accounts_enabled", True)
    monkeypatch.setattr(
        credentials_router, "get_access_service", lambda: AllowingAccessService()
    )


def _install(monkeypatch, sign_ins: Dict[UUID, UUID]) -> _Accounts:
    accounts = _Accounts(sign_ins)
    monkeypatch.setattr(account_choices_module, "_account_choices_service", accounts)
    return accounts


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@contextmanager
def _session(*, person: UUID, project_id: UUID, organization_id: UUID):
    """A browser session of `person` in one project: the request access and the scope the
    auth middleware sets for it."""
    envelope = envelope_for_claims(
        user_id=person, project_id=project_id, organization_id=organization_id
    )
    access_token = set_request_access(
        make_request_access(envelope=envelope, credential_kind="bearer_session")
    )
    scope_token = set_auth_context(
        AuthContext(
            credentials=SecretCredentials(value="session"),
            scope=AuthScope(
                organization_id=organization_id,
                workspace_id=organization_id,
                project_id=project_id,
                user_id=person,
            ),
        )
    )
    try:
        yield envelope
    finally:
        reset_auth_context(scope_token)
        reset_request_access(access_token)


async def _mint(monkeypatch, *, envelope, item_keys) -> str:
    """`POST /gateways/credentials` as the session, with `item_keys`."""
    scope = AuthScope(
        organization_id=envelope.authority.organization_id,
        workspace_id=envelope.authority.organization_id,
        project_id=envelope.authority.project_id,
        user_id=envelope.authority.principal.id,
    )
    monkeypatch.setattr(credentials_router, "get_auth_scope", lambda: scope)
    request = _request("/gateways/credentials")
    request.state.run_envelope = envelope
    response = await GatewayCredentialsRouter().issue_gateway_credentials(
        request, body=GatewayCredentialsRequest(item_keys=item_keys)
    )
    return response.credentials.removeprefix("Secret ")


def _claims(token: str) -> dict:
    return decode(
        token, SECRET_KEY, algorithms=["HS256"], options={"verify_aud": False}
    )


@contextmanager
def _presenting(request: Request):
    """The data plane's view of the credential: what the auth middleware verified."""
    token = set_request_access(auth._build_request_access_from_state(request))
    try:
        yield
    finally:
        reset_request_access(token)


async def _list_tools(service, token: str, *, account_source="user"):
    request = _request(f"/gateways/mcps/custom/{SLUG}")
    await auth.verify_secret_token(request=request, secret_token=token)
    claims = _claims(token)
    scope = AuthScope(
        organization_id=UUID(claims["organization_id"]),
        project_id=UUID(claims["project_id"]),
        user_id=UUID(claims["user_id"]),
    )
    with _presenting(request):
        return await service.relay(
            scope=scope,
            namespace="custom",
            name=SLUG,
            context=MCPCallContext(method="tools/list"),
            body=b"{}",
            headers={},
            request=request,
            account_source=account_source,
        )


# -- the exchange -------------------------------------------------------------------


async def test_a_session_credential_carries_the_callers_own_sign_in(monkeypatch):
    person, grant = uuid4(), uuid4()
    accounts = _install(monkeypatch, {person: grant})
    project_id, organization_id = uuid4(), uuid4()

    with _session(
        person=person, project_id=project_id, organization_id=organization_id
    ) as envelope:
        token = await _mint(monkeypatch, envelope=envelope, item_keys=[ITEM_KEY])

    assert _claims(token)["run_accounts"] == [
        {"item_key": ITEM_KEY, "secret_id": str(grant)}
    ]
    (call,) = accounts.calls
    assert call["user_id"] == person
    assert call["project_id"] == project_id
    assert call["organization_id"] == organization_id


async def test_item_keys_never_reach_another_persons_sign_in(monkeypatch):
    """The keys only name items: the account read is always for the session's person,
    whatever the keys hold, so a viewer with no sign-in gets nothing while a colleague
    has one on the same server."""
    colleague, viewer = uuid4(), uuid4()
    accounts = _install(monkeypatch, {colleague: uuid4()})

    with _session(person=viewer, project_id=uuid4(), organization_id=uuid4()) as env_:
        token = await _mint(
            monkeypatch,
            envelope=env_,
            # A key whose text is the colleague's id is still only an item name.
            item_keys=[ITEM_KEY, f"mcp_server:user/{colleague}"],
        )

    assert "run_accounts" not in _claims(token)
    (call,) = accounts.calls
    assert call["user_id"] == viewer
    assert [item.match_text for item in call["items"]] == [SLUG, str(colleague)]


async def test_no_item_keys_read_no_account(monkeypatch):
    accounts = _install(monkeypatch, {})
    with _session(person=uuid4(), project_id=uuid4(), organization_id=uuid4()) as env_:
        token = await _mint(monkeypatch, envelope=env_, item_keys=None)
    assert "run_accounts" not in _claims(token)
    assert accounts.calls == []


async def test_both_exchanges_sign_the_same_claim_for_the_same_input(monkeypatch):
    """`GET /access/permissions/check` and `POST /gateways/credentials` share one
    function for the claim, so the same session and keys give the same accounts."""
    person, grant = uuid4(), uuid4()
    _install(monkeypatch, {person: grant})
    project_id, organization_id = uuid4(), uuid4()

    class _Allow:
        async def check_request(self, **kwargs):
            return Decision(allowed=True, reason=DecisionReason.ROLE)

    async def _resource_ok(**kwargs):
        return True

    monkeypatch.setattr(access_router_module, "get_access_service", lambda: _Allow())
    monkeypatch.setattr(access_router_module, "_check_resource_access", _resource_ok)

    with _session(
        person=person, project_id=project_id, organization_id=organization_id
    ) as envelope:
        gateway_token = await _mint(
            monkeypatch, envelope=envelope, item_keys=[ITEM_KEY]
        )
        request = _request("/access/permissions/check")
        request.state.run_envelope = envelope
        allowed = await AccessRouter().check_permissions(
            request,
            action="run_service",
            scope_type=None,
            scope_id=None,
            resource_type="service",
            resource_id=None,
            without_grants=True,
            workflow_id=None,
            item_keys=[ITEM_KEY],
            session_id=None,
        )

    access_token = json.loads(allowed.body)["credentials"].removeprefix("Secret ")
    assert (
        _claims(gateway_token)["run_accounts"]
        == _claims(access_token)["run_accounts"]
        == [{"item_key": ITEM_KEY, "secret_id": str(grant)}]
    )


# -- the tool list on the data plane ---------------------------------------------------


async def test_the_tool_list_uses_the_callers_own_sign_in(monkeypatch):
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao, project_secret=False)
    person = uuid4()
    grant = _person_grant(endpoint=endpoint, person=person)
    _install(monkeypatch, {person: grant.secret.id})
    resolver = _RecordingResolver(secrets=[grant])
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with _session(
        person=person, project_id=uuid4(), organization_id=uuid4()
    ) as envelope:
        token = await _mint(monkeypatch, envelope=envelope, item_keys=[ITEM_KEY])
    result = await _list_tools(service, token)

    assert result.status_code == 200
    assert resolver.refs == [
        BoundSecretRef(
            secret_id=grant.secret.id, owner_kind=SecretOwnerKind.USER, user_id=person
        )
    ]
    assert adapter.last_auth.secret.secret.id == grant.secret.id


async def test_a_viewer_without_a_sign_in_gets_no_tools_and_no_colleagues(monkeypatch):
    """A colleague's sign-in on the same server never lists tools for the viewer."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao, project_secret=False)
    colleague, viewer = uuid4(), uuid4()
    _install(
        monkeypatch,
        {colleague: _person_grant(endpoint=endpoint, person=colleague).secret.id},
    )
    resolver = _RecordingResolver()
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with _session(
        person=viewer, project_id=uuid4(), organization_id=uuid4()
    ) as envelope:
        token = await _mint(monkeypatch, envelope=envelope, item_keys=[ITEM_KEY])
    with pytest.raises(MCPSignInMissingError):
        await _list_tools(service, token)

    assert resolver.refs == []
    assert adapter.relay_calls == 0


async def test_the_account_read_is_scoped_to_the_sessions_project(monkeypatch):
    """The account read takes the project and organization of the session. A body that
    also names another project or person changes nothing: the request has no such
    field, and the claim is built from the authenticated request alone."""
    person, grant = uuid4(), uuid4()
    accounts = _install(monkeypatch, {person: grant})
    project_id, organization_id = uuid4(), uuid4()
    body = GatewayCredentialsRequest.model_validate(
        {"item_keys": [ITEM_KEY], "project_id": str(uuid4()), "user_id": str(uuid4())}
    )

    with _session(
        person=person, project_id=project_id, organization_id=organization_id
    ) as envelope:
        scope = AuthScope(
            organization_id=organization_id,
            workspace_id=organization_id,
            project_id=project_id,
            user_id=person,
        )
        monkeypatch.setattr(credentials_router, "get_auth_scope", lambda: scope)
        request = _request("/gateways/credentials")
        request.state.run_envelope = envelope
        response = await GatewayCredentialsRouter().issue_gateway_credentials(
            request, body=body
        )

    (call,) = accounts.calls
    assert (call["project_id"], call["organization_id"], call["user_id"]) == (
        project_id,
        organization_id,
        person,
    )
    claims = _claims(response.credentials.removeprefix("Secret "))
    assert claims["project_id"] == str(project_id)
    assert claims["run_accounts"] == [{"item_key": ITEM_KEY, "secret_id": str(grant)}]


async def test_a_server_with_a_project_sign_in_keeps_the_project_path(monkeypatch):
    """Without `account_source=user` (the view's path while the project is signed in)
    the tool list reads the project's grant, as before."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao, project_secret=True)
    project_sign_in = _person_grant(endpoint=endpoint, person=uuid4())
    _install(monkeypatch, {})
    resolver = _RecordingResolver(secrets=[project_sign_in])
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
    )

    with _session(person=uuid4(), project_id=uuid4(), organization_id=uuid4()) as env_:
        token = await _mint(monkeypatch, envelope=env_, item_keys=None)
    await _list_tools(service, token, account_source="agent")

    assert resolver.refs == [BoundSecretRef(secret_id=endpoint.secret_id)]


async def test_no_sign_in_anywhere_answers_auth_required_as_before(monkeypatch):
    """The project path of a server nobody signed in to: the same refusal as today."""
    dao = MockMCPEndpointsDAO()
    await _server(dao, project_secret=False)
    _install(monkeypatch, {})
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=_RecordingResolver(),
        adapters={"http": MockUpstreamAdapter()},
    )

    with _session(person=uuid4(), project_id=uuid4(), organization_id=uuid4()) as env_:
        token = await _mint(monkeypatch, envelope=env_, item_keys=None)
    with pytest.raises(MCPAuthRequiredError):
        await _list_tools(service, token, account_source="agent")
