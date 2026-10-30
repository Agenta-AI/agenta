"""A person's own sign-in to a project MCP server, in the connect service.

A sign-in is the person's row at the slug that the server's id and mode give. The
service writes and deletes only the caller's own row, starts an OAuth attempt that says it
is for the person, and lists the caller's sign-ins in one read.
"""

import time
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
from oss.src.core.gateways.mcps.oauth.sign_ins import is_sign_in_ready
from oss.src.core.gateways.mcps.oauth.storage import grant_slug, token_slug
from oss.src.core.secrets.dtos import (
    OAuthGrantDTO,
    OAuthGrantSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretKind, SecretOwnerKind
from oss.src.core.shared.dtos import Header
from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
    _API_URL,
    _SERVER_URL,
    _FakeSecretsDAO,
    _mock_as_handler,
    _private_resolve,
)
from oss.tests.pytest.utils.mcp_endpoints import InMemoryMCPEndpoints
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO
from oss.tests.pytest.utils.person_vault import PersonRowsVaultService


def _service():
    attempts = InMemoryMCPOAuthAttemptsDAO()
    vault = PersonRowsVaultService(secrets_dao=_FakeSecretsDAO())
    endpoints = InMemoryMCPEndpoints(attempts=attempts)
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=MCPOAuthClient(transport=httpx.MockTransport(_mock_as_handler())),
        api_url=_API_URL,
        attempts_dao=attempts,
        endpoints_dao=endpoints,
        resolve=_private_resolve,
    )
    return service, vault, attempts


PROJECT = uuid4()


def _server(auth_mode: MCPAuthScheme, service=None) -> MCPEndpoint:
    """A project server, stored in the service's endpoints when one is given."""
    endpoint = MCPEndpoint(
        id=uuid4(),
        slug="acme",
        auth_mode=auth_mode,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
    )
    if service is not None:
        service.endpoints_dao.put(endpoint)
    return endpoint


async def _token(service, *, organization_id, person, server, token="t"):
    return await service.sign_in_with_token(
        organization_id=organization_id,
        project_id=PROJECT,
        user_id=person,
        endpoint_id=server.id,
        server_url=server.data.route.base_url,
        token=token,
    )


async def _sign_out(service, *, organization_id, person, server):
    return await service.sign_out(
        organization_id=organization_id,
        project_id=PROJECT,
        user_id=person,
        endpoint_id=server.id,
    )


def _grant_row(*, slug, expires_at, refresh_token) -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        slug=slug,
        kind=SecretKind.OAUTH_GRANT,
        data=OAuthGrantDTO(
            grant=OAuthGrantSettingsDTO(
                server=_SERVER_URL,
                access_token="a",
                refresh_token=refresh_token,
                expires_at=expires_at,
                scopes=[],
            )
        ),
        header=Header(name="grant"),
    )


@pytest.mark.asyncio
async def test_a_person_signs_in_to_a_token_server_with_their_own_token():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY, service)
    organization_id, person = uuid4(), uuid4()

    row = await _token(
        service,
        organization_id=organization_id,
        person=person,
        server=server,
        token="tk-1",
    )

    stored = vault.person_rows[(organization_id, person, token_slug(server.id))]
    assert stored.id == row.id
    assert stored.kind == SecretKind.MCP_TOKEN
    assert stored.data.secret.content == "tk-1"
    # A second sign-in replaces the token in the same row.
    again = await _token(
        service,
        organization_id=organization_id,
        person=person,
        server=server,
        token="tk-2",
    )
    assert again.id == row.id
    assert len(vault.person_rows) == 1


@pytest.mark.asyncio
async def test_a_person_signs_out_of_their_own_row_only():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY, service)
    organization_id, me, colleague = uuid4(), uuid4(), uuid4()
    for person in (me, colleague):
        await _token(
            service, organization_id=organization_id, person=person, server=server
        )

    assert await _sign_out(
        service, organization_id=organization_id, person=me, server=server
    )
    # Idempotent: signing out again changes nothing and is no error.
    assert await _sign_out(
        service, organization_id=organization_id, person=me, server=server
    )
    assert list(vault.person_rows) == [
        (organization_id, colleague, token_slug(server.id))
    ]


@pytest.mark.asyncio
async def test_signing_out_of_an_oauth_server_deletes_the_persons_grant():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.OAUTH, service)
    organization_id, person = uuid4(), uuid4()
    vault.person_rows[(organization_id, person, grant_slug(server.id))] = _grant_row(
        slug=grant_slug(server.id), expires_at=None, refresh_token=None
    )

    assert await _sign_out(
        service, organization_id=organization_id, person=person, server=server
    )
    assert vault.person_rows == {}


@pytest.mark.asyncio
async def test_the_sign_ins_of_many_servers_are_read_in_one_call():
    service, vault, _ = _service()
    oauth, token, open_server = (
        _server(MCPAuthScheme.OAUTH),
        _server(MCPAuthScheme.API_KEY, service),
        _server(MCPAuthScheme.NONE),
    )
    organization_id, person = uuid4(), uuid4()
    await _token(service, organization_id=organization_id, person=person, server=token)
    vault.person_calls.clear()

    sign_ins = await service.sign_ins(
        organization_id=organization_id,
        user_id=person,
        endpoints=[oauth, token, open_server],
    )

    assert vault.person_calls == ["list_personal_sign_ins"]
    assert sign_ins == {token.id: True}


@pytest.mark.asyncio
async def test_no_sign_in_server_costs_no_read():
    service, vault, _ = _service()

    sign_ins = await service.sign_ins(
        organization_id=uuid4(),
        user_id=uuid4(),
        endpoints=[_server(MCPAuthScheme.NONE)],
    )

    assert sign_ins == {}
    assert vault.person_calls == []


def test_a_token_is_ready_and_a_dead_grant_is_not():
    now = time.time()
    token = SecretResponseDTO(
        id=uuid4(),
        slug="t",
        kind=SecretKind.MCP_TOKEN,
        data={"secret": {"format": "text", "content": "x"}},
        header=Header(name="t"),
    )
    assert is_sign_in_ready(token, now=now)
    assert is_sign_in_ready(
        _grant_row(slug="g", expires_at=None, refresh_token=None), now=now
    )
    assert is_sign_in_ready(
        _grant_row(slug="g", expires_at=int(now) - 10, refresh_token="r"), now=now
    )
    assert not is_sign_in_ready(
        _grant_row(slug="g", expires_at=int(now) - 10, refresh_token=None), now=now
    )


@pytest.mark.asyncio
async def test_begin_records_that_the_attempt_is_for_the_person():
    service, _, attempts = _service()

    start = await service.begin(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
        owner_kind=SecretOwnerKind.USER,
    )

    assert attempts.attempts[start.state].owner_kind == SecretOwnerKind.USER


@pytest.mark.asyncio
async def test_an_attempt_is_for_the_project_unless_it_says_otherwise():
    service, _, attempts = _service()

    start = await service.begin(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    assert attempts.attempts[start.state].owner_kind == SecretOwnerKind.PROJECT


@pytest.mark.asyncio
async def test_delete_sign_ins_removes_every_persons_row_at_the_slugs():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY, service)
    organization_id = uuid4()
    for person in (uuid4(), uuid4()):
        await _token(
            service, organization_id=organization_id, person=person, server=server
        )

    deleted = await service.delete_sign_ins(
        organization_id=organization_id,
        project_id=uuid4(),
        slugs=[token_slug(server.id)],
    )

    assert deleted == 2
    assert vault.person_rows == {}


# --- the person's own grant: written at the callback, renewed in place ------------ #


def _service_with(handler):
    attempts = InMemoryMCPOAuthAttemptsDAO()
    vault = PersonRowsVaultService(secrets_dao=_FakeSecretsDAO())
    endpoints = InMemoryMCPEndpoints(attempts=attempts)
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=MCPOAuthClient(transport=httpx.MockTransport(handler)),
        api_url=_API_URL,
        attempts_dao=attempts,
        endpoints_dao=endpoints,
        resolve=_private_resolve,
    )
    return service, vault, endpoints


@pytest.mark.asyncio
async def test_a_persons_consent_writes_their_own_grant_and_binds_nothing():
    service, vault, endpoints = _service_with(_mock_as_handler())
    organization_id, project_id, person, endpoint_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )

    start = await service.begin(
        project_id=project_id,
        user_id=person,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
        owner_kind=SecretOwnerKind.USER,
    )
    attempt = await service.claim(state=start.state, caller_user_id=person)
    completion = await service.complete(
        attempt=attempt, code="code-1", organization_id=organization_id
    )

    grant = vault.person_rows[(organization_id, person, grant_slug(endpoint_id))]
    assert completion.secret_id == grant.id
    assert grant.kind == SecretKind.OAUTH_GRANT
    assert grant.data.grant.access_token == "tok-xyz"
    # No project grant, and the server still names no grant of its own.
    assert not [
        r for _, r in vault.secrets_dao.records if r.kind == SecretKind.OAUTH_GRANT
    ]
    assert endpoints.endpoints.get(endpoint_id) is None or (
        endpoints.endpoints[endpoint_id].secret_id is None
    )


@pytest.mark.asyncio
async def test_a_persons_consent_needs_the_organization():
    service, _, _ = _service_with(_mock_as_handler())
    person = uuid4()
    start = await service.begin(
        project_id=uuid4(),
        user_id=person,
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
        owner_kind=SecretOwnerKind.USER,
    )
    attempt = await service.claim(state=start.state, caller_user_id=person)

    with pytest.raises(ValueError):
        await service.complete(attempt=attempt, code="c")


@pytest.mark.asyncio
async def test_a_persons_grant_is_renewed_in_their_own_row():
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
        _refreshing_as_handler,
    )
    from mcp.shared.auth import OAuthToken

    from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
    from oss.src.core.secrets.dtos import SecretOwner

    calls = []
    service, vault, _ = _service_with(_refreshing_as_handler(calls=calls))
    organization_id, project_id, person, endpoint_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=person)
    storage = SecretsTokenStorage(
        vault_service=vault,
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server="https://auth.acme.io/",
        owner=owner,
    )
    seeded = await storage.write_tokens(
        OAuthToken(
            access_token="stale",
            token_type="Bearer",
            expires_in=-60,
            refresh_token="renew-me",
        )
    )

    await service.refresh_grant(
        project_id=project_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        owner=owner,
    )

    assert calls == ["refresh_token"]
    renewed = vault.person_rows[(organization_id, person, grant_slug(endpoint_id))]
    assert renewed.id == seeded.id
    assert renewed.data.grant.access_token == "renewed-1"
    assert renewed.data.grant.refresh_token == "renew-me"
    assert not [
        r for _, r in vault.secrets_dao.records if r.kind == SecretKind.OAUTH_GRANT
    ]


@pytest.mark.asyncio
async def test_a_token_for_a_server_that_moved_to_oauth_is_not_written():
    """The router read a token server; by the time the write takes the server's lock, an
    admin moved it to OAuth and deleted every token. The write must not bring one back."""
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY, service)
    service.endpoints_dao.put(
        server.model_copy(update={"auth_mode": MCPAuthScheme.OAUTH})
    )

    stored = await _token(
        service, organization_id=uuid4(), person=uuid4(), server=server
    )

    assert stored is None
    assert vault.person_rows == {}


@pytest.mark.asyncio
async def test_a_token_for_a_deleted_server_is_not_written():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY)  # never stored: deleted

    assert (
        await _token(service, organization_id=uuid4(), person=uuid4(), server=server)
        is None
    )
    assert vault.person_rows == {}


@pytest.mark.asyncio
async def test_signing_out_cancels_only_the_persons_own_attempts():
    """A consent still in flight would write the grant back after the sign-out."""
    service, _, attempts = _service()
    server = _server(MCPAuthScheme.OAUTH, service)
    person, admin = uuid4(), uuid4()
    mine = await service.begin(
        project_id=PROJECT,
        user_id=person,
        endpoint_id=server.id,
        server_url=_SERVER_URL,
        scopes=["read"],
        owner_kind=SecretOwnerKind.USER,
    )
    projects = await service.begin(
        project_id=PROJECT,
        user_id=admin,
        endpoint_id=server.id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    await _sign_out(service, organization_id=uuid4(), person=person, server=server)

    assert attempts.attempts[mine.state].status.value == "cancelled"
    assert attempts.attempts[projects.state].status.value == "pending"


@pytest.mark.asyncio
async def test_a_token_for_a_server_that_moved_to_another_address_is_not_written():
    """An edit moved the server and deleted every token before this write took the lock.
    The token was entered for the old address and must not reach the new one."""
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY, service)
    moved = server.model_copy(
        update={
            "data": MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://elsewhere.example/mcp")
            )
        }
    )
    service.endpoints_dao.put(moved)

    stored = await _token(
        service, organization_id=uuid4(), person=uuid4(), server=server
    )

    assert stored is None
    assert vault.person_rows == {}


async def _seed_person_grant(service, vault, *, refresh_token="renew-me"):
    from mcp.shared.auth import OAuthToken

    from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
    from oss.src.core.secrets.dtos import SecretOwner

    organization_id, person, endpoint_id = uuid4(), uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=person)
    await SecretsTokenStorage(
        vault_service=vault,
        project_id=PROJECT,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server="https://auth.acme.io/",
        owner=owner,
    ).write_tokens(
        OAuthToken(
            access_token="stale",
            token_type="Bearer",
            expires_in=-60,
            refresh_token=refresh_token,
        )
    )
    return owner, endpoint_id, (organization_id, person, grant_slug(endpoint_id))


@pytest.mark.asyncio
async def test_a_person_grant_the_server_refuses_for_good_is_deleted():
    """So the list says "not signed in" and Needs setup asks the person again."""
    from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshFailedError
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
        _refreshing_as_handler,
    )

    service, vault, _ = _service_with(_refreshing_as_handler(calls=[], refusal=True))
    owner, endpoint_id, key = await _seed_person_grant(service, vault)

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(
            project_id=PROJECT,
            endpoint_id=endpoint_id,
            server_url=_SERVER_URL,
            owner=owner,
        )

    assert key not in vault.person_rows


@pytest.mark.asyncio
async def test_a_person_grant_with_no_refresh_token_is_deleted_when_it_dies():
    from oss.src.core.gateways.mcps.oauth.types import MCPOAuthNoRefreshTokenError

    service, vault, _ = _service_with(_mock_as_handler())
    owner, endpoint_id, key = await _seed_person_grant(
        service, vault, refresh_token=None
    )

    with pytest.raises(MCPOAuthNoRefreshTokenError):
        await service.refresh_grant(
            project_id=PROJECT,
            endpoint_id=endpoint_id,
            server_url=_SERVER_URL,
            failed_access_token="stale",
            owner=owner,
        )

    assert key not in vault.person_rows


@pytest.mark.asyncio
async def test_a_person_grant_survives_a_token_endpoint_outage():
    """A failure on the server's side says nothing about the grant: it stays."""
    import httpx as _httpx

    from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshUnavailableError
    from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
        _refreshing_as_handler,
    )

    inner = _refreshing_as_handler(calls=[])

    def handler(request):
        if request.url.path == "/token":
            return _httpx.Response(503)
        return inner(request)

    service, vault, _ = _service_with(handler)
    owner, endpoint_id, key = await _seed_person_grant(service, vault)

    with pytest.raises(MCPOAuthRefreshUnavailableError):
        await service.refresh_grant(
            project_id=PROJECT,
            endpoint_id=endpoint_id,
            server_url=_SERVER_URL,
            owner=owner,
        )

    assert key in vault.person_rows
