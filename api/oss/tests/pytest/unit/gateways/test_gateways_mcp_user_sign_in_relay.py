"""The MCP relay for a "user" item: the run person's own sign-in on a project server.

The request says "user" with `account_source=user`. The relay then reads the claim entry
for `mcp_server:user/<slug>` and uses that person's row, never the project's. With no
entry, it answers "not found" and never falls back to the project's sign-in.
"""

import time
from contextlib import contextmanager
from typing import List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.account_choices.dtos import RunAccount
from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPCallContext,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.storage import grant_slug, token_slug
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshFailedError
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPSignInMissingError,
)
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    ResolvedSecret,
    SecretMode,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.gateways.policy.types import SecretNotFoundError
from oss.src.core.secrets.dtos import (
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    OAuthGrantDTO,
    OAuthGrantSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomSecretFormat, SecretKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
    MockMCPEndpointsDAO,
    MockUpstreamAdapter,
    _refused_credential_result,
    _relay_service,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

SLUG = "acme-notion"
ITEM_KEY = f"mcp_server:user/{SLUG}"


@pytest.fixture(autouse=True)
def _personal_accounts_on(monkeypatch):
    """The deployment switch; with it off, no claim entry is read (see the last case)."""
    monkeypatch.setattr(env.agenta.access, "personal_accounts_enabled", True)


def _scope() -> AuthScope:
    return AuthScope(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())


@contextmanager
def _run(*, person: UUID, accounts: List[RunAccount], kind: str = "human"):
    """A run credential of `person`, carrying the claim `run_accounts`."""
    access = make_request_access(
        envelope=make_envelope(kind=kind, principal_id=person),
        credential_kind="run_credential",
    ).model_copy(update={"run_accounts": tuple(accounts)})
    token = set_request_access(access)
    try:
        yield
    finally:
        reset_request_access(token)


async def _server(dao, *, auth_mode=MCPAuthScheme.OAUTH, project_secret=True):
    return await dao.create_endpoint(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug=SLUG,
            auth_mode=auth_mode,
            secret_id=uuid4() if project_secret else None,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://example.com/mcp")
            ),
        ),
    )


def _person_grant(
    *, endpoint: MCPEndpoint, person: UUID, access_token="person-token", expires_at=None
) -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            slug=grant_slug(endpoint.id),
            kind=SecretKind.OAUTH_GRANT,
            data=OAuthGrantDTO(
                grant=OAuthGrantSettingsDTO(
                    server="https://example.com/mcp",
                    access_token=access_token,
                    refresh_token="renewal",
                    expires_at=expires_at,
                    scopes=[],
                )
            ),
            header=Header(name="grant"),
        ),
        owner=SecretOwner.for_user(organization_id=uuid4(), user_id=person),
        origin=SecretOrigin.VAULT,
    )


def _person_token(*, endpoint: MCPEndpoint, person: UUID, slug=None) -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            slug=slug or token_slug(endpoint.id),
            kind=SecretKind.MCP_TOKEN,
            data=CustomSecretDTO(
                secret=CustomSecretSettingsDTO(
                    format=CustomSecretFormat.TEXT, content="person-api-token"
                )
            ),
            header=Header(name="token"),
        ),
        owner=SecretOwner.for_user(organization_id=uuid4(), user_id=person),
        origin=SecretOrigin.VAULT,
    )


class _RecordingResolver:
    """Records every reference; answers from a list, or raises."""

    def __init__(self, *, secrets: Optional[List[ResolvedSecret]] = None, error=None):
        self.refs: List[BoundSecretRef] = []
        self.modes: List[SecretMode] = []
        self._secrets = list(secrets or [])
        self._error = error

    async def resolve(self, *, scope, ref, mode):
        self.refs.append(ref)
        self.modes.append(mode)
        if self._error is not None:
            raise self._error
        return self._secrets[min(len(self.refs), len(self._secrets)) - 1]

    async def available_provider_keys(self, *, scope):
        return set()


class _Refresher:
    def __init__(self, *, failure=None):
        self.calls: List[dict] = []
        self._failure = failure

    async def refresh_grant(self, **kwargs):
        self.calls.append(kwargs)
        if self._failure is not None:
            raise self._failure


async def _relay(service, scope, *, account_source="user"):
    return await service.relay(
        scope=scope,
        namespace="custom",
        name=SLUG,
        context=MCPCallContext(method="tools/call", target="write_page"),
        body=b"{}",
        headers={},
        account_source=account_source,
    )


@pytest.mark.asyncio
async def test_a_user_request_uses_the_run_persons_grant_from_the_claim():
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    person = uuid4()
    grant = _person_grant(endpoint=endpoint, person=person)
    resolver = _RecordingResolver(secrets=[grant])
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=grant.secret.id)],
    ):
        result = await _relay(service, _scope())

    assert result.status_code == 200
    # Exactly one read, of the person's row: the round trips of the agent path.
    assert resolver.refs == [
        BoundSecretRef(
            secret_id=grant.secret.id, owner_kind=SecretOwnerKind.USER, user_id=person
        )
    ]
    assert adapter.last_auth.secret.secret.id == grant.secret.id


@pytest.mark.asyncio
async def test_a_user_request_with_no_claim_entry_is_not_found_and_never_falls_back():
    dao = MockMCPEndpointsDAO()
    await _server(dao, project_secret=True)
    resolver = _RecordingResolver()
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with _run(person=uuid4(), accounts=[]):
        with pytest.raises(MCPSignInMissingError):
            await _relay(service, _scope())

    assert resolver.refs == []
    assert adapter.relay_calls == 0


@pytest.mark.asyncio
async def test_a_run_with_no_person_has_no_sign_in():
    """An API key or an automation run by one has no run person, so a "user" item is
    left out even when a claim entry exists."""
    dao = MockMCPEndpointsDAO()
    await _server(dao)
    resolver = _RecordingResolver()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
    )

    with _run(
        person=uuid4(),
        kind="api_key",
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=uuid4())],
    ):
        with pytest.raises(MCPSignInMissingError):
            await _relay(service, _scope())
    assert resolver.refs == []


@pytest.mark.asyncio
async def test_a_sign_in_deleted_since_run_start_is_not_found():
    dao = MockMCPEndpointsDAO()
    await _server(dao)
    resolver = _RecordingResolver(
        error=SecretNotFoundError(
            mode=SecretMode.USER_REQUIRED, missing=SecretOwnerKind.USER, target="x"
        )
    )
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
    )

    with _run(
        person=uuid4(), accounts=[RunAccount(item_key=ITEM_KEY, secret_id=uuid4())]
    ):
        with pytest.raises(MCPSignInMissingError):
            await _relay(service, _scope())


@pytest.mark.asyncio
async def test_a_row_for_another_server_or_mode_is_not_found():
    """The claim names a row by id. The relay uses it only if it is this server's
    sign-in of this server's mode, so a token row is never sent to an OAuth server."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao, auth_mode=MCPAuthScheme.OAUTH)
    person = uuid4()
    token = _person_token(endpoint=endpoint, person=person)
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=_RecordingResolver(secrets=[token]),
        adapters={"http": adapter},
    )

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=token.secret.id)],
    ):
        with pytest.raises(MCPSignInMissingError):
            await _relay(service, _scope())
    assert adapter.relay_calls == 0


@pytest.mark.asyncio
async def test_a_token_server_sends_the_persons_token():
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao, auth_mode=MCPAuthScheme.API_KEY)
    person = uuid4()
    token = _person_token(endpoint=endpoint, person=person)
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=_RecordingResolver(secrets=[token]),
        adapters={"http": adapter},
    )

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=token.secret.id)],
    ):
        result = await _relay(service, _scope())

    assert result.status_code == 200
    assert adapter.last_auth.secret.secret.id == token.secret.id


@pytest.mark.asyncio
async def test_an_agent_request_still_uses_the_projects_sign_in():
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    project_grant = _person_grant(endpoint=endpoint, person=uuid4())
    resolver = _RecordingResolver(secrets=[project_grant])
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": MockUpstreamAdapter()},
    )

    with _run(
        person=uuid4(), accounts=[RunAccount(item_key=ITEM_KEY, secret_id=uuid4())]
    ):
        await _relay(service, _scope(), account_source="agent")

    assert resolver.refs == [BoundSecretRef(secret_id=endpoint.secret_id)]


@pytest.mark.asyncio
async def test_an_expired_person_grant_is_renewed_for_that_person():
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    person = uuid4()
    stale = _person_grant(
        endpoint=endpoint, person=person, expires_at=int(time.time()) - 60
    )
    renewed = _person_grant(
        endpoint=endpoint,
        person=person,
        access_token="renewed",
        expires_at=int(time.time()) + 3600,
    )
    resolver = _RecordingResolver(secrets=[stale, renewed])
    refresher = _Refresher()
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=resolver,
        adapters={"http": adapter},
        oauth_refresher=refresher,
    )
    scope = _scope()

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=stale.secret.id)],
    ):
        await _relay(service, scope)

    assert len(refresher.calls) == 1
    assert refresher.calls[0]["owner"] == SecretOwner.for_user(
        organization_id=scope.organization_id, user_id=person
    )
    # The re-read names the person's row again, never the project's.
    assert all(ref.owner_kind == SecretOwnerKind.USER for ref in resolver.refs)
    assert adapter.last_auth.secret.secret.data.grant.access_token == "renewed"


@pytest.mark.asyncio
async def test_a_refused_person_grant_asks_that_person_to_sign_in_again():
    """The project's connection stays valid: only this person's sign-in failed, and the
    reconnect action is the person's own sign-in."""
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    person = uuid4()
    grant = _person_grant(endpoint=endpoint, person=person)
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=_RecordingResolver(secrets=[grant]),
        adapters={"http": MockUpstreamAdapter(result=_refused_credential_result())},
        oauth_refresher=_Refresher(
            failure=MCPOAuthRefreshFailedError(server_url="x", detail="dead")
        ),
    )
    scope = _scope()

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=grant.secret.id)],
    ):
        with pytest.raises(MCPAuthRequiredError) as excinfo:
            await _relay(service, scope)

    assert excinfo.value.requirement.connect.endpoint == (
        f"/gateways/mcps/endpoints/{endpoint.id}/connect?owner_kind=user"
    )
    stored = await dao.fetch_endpoint(
        project_id=scope.project_id, endpoint_id=endpoint.id
    )
    assert stored.flags.is_valid is True


@pytest.mark.asyncio
async def test_a_user_call_costs_the_same_round_trips_as_an_agent_call():
    """No added round trips on the run path: the run person's sign-in is one read by id,
    where the agent path reads the project's row by id. Same endpoint reads, same secret
    reads, no other call."""

    async def counts(account_source):
        dao = MockMCPEndpointsDAO()
        endpoint = await _server(dao)
        person = uuid4()
        grant = _person_grant(endpoint=endpoint, person=person)
        resolver = _RecordingResolver(secrets=[grant])
        service = _relay_service(
            mcp_endpoints_dao=dao,
            resolver=resolver,
            adapters={"http": MockUpstreamAdapter()},
        )
        dao.calls.clear()
        with _run(
            person=person,
            accounts=[RunAccount(item_key=ITEM_KEY, secret_id=grant.secret.id)],
        ):
            await _relay(service, _scope(), account_source=account_source)
        return list(dao.calls), len(resolver.refs)

    assert await counts("user") == await counts("agent")
    assert (await counts("user"))[1] == 1


@pytest.mark.asyncio
async def test_a_scope_challenge_on_a_person_grant_is_the_persons_to_answer():
    from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
    from oss.src.core.gateways.mcps.types import MCPScopeInsufficientError

    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    person = uuid4()
    grant = _person_grant(endpoint=endpoint, person=person)
    challenge = MCPRelayResult(
        status_code=403,
        headers={
            "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="write"'
        },
        body=b"{}",
    )
    service = _relay_service(
        mcp_endpoints_dao=dao,
        resolver=_RecordingResolver(secrets=[grant]),
        adapters={"http": MockUpstreamAdapter(result=challenge)},
    )

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=grant.secret.id)],
    ):
        with pytest.raises(MCPScopeInsufficientError) as excinfo:
            await _relay(service, _scope())

    assert excinfo.value.for_person is True


def test_the_missing_sign_in_message_names_the_server_not_the_gateway_path():
    error = MCPSignInMissingError(
        target="custom/acme-notion", server_name="Acme Notion"
    )

    assert error.message == "Sign in to Acme Notion to use it."
    assert error.target == "custom/acme-notion"


@pytest.mark.asyncio
async def test_with_personal_accounts_off_a_user_item_has_no_sign_in(monkeypatch):
    """A claim signed while the switch was on is not read once it is off, and the
    project's sign-in is still never used in its place."""
    monkeypatch.setattr(env.agenta.access, "personal_accounts_enabled", False)
    dao = MockMCPEndpointsDAO()
    endpoint = await _server(dao)
    person = uuid4()
    grant = _person_grant(endpoint=endpoint, person=person)
    resolver = _RecordingResolver(secrets=[grant])
    adapter = MockUpstreamAdapter()
    service = _relay_service(
        mcp_endpoints_dao=dao, resolver=resolver, adapters={"http": adapter}
    )

    with _run(
        person=person,
        accounts=[RunAccount(item_key=ITEM_KEY, secret_id=grant.secret.id)],
    ):
        with pytest.raises(MCPSignInMissingError):
            await _relay(service, _scope())

    assert resolver.refs == []
    assert adapter.relay_calls == 0
