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
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=MCPOAuthClient(transport=httpx.MockTransport(_mock_as_handler())),
        api_url=_API_URL,
        attempts_dao=attempts,
        endpoints_dao=InMemoryMCPEndpoints(attempts=attempts),
        resolve=_private_resolve,
    )
    return service, vault, attempts


def _server(auth_mode: MCPAuthScheme) -> MCPEndpoint:
    return MCPEndpoint(
        id=uuid4(),
        slug="acme",
        auth_mode=auth_mode,
        data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
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
    server = _server(MCPAuthScheme.API_KEY)
    organization_id, person = uuid4(), uuid4()

    row = await service.sign_in_with_token(
        organization_id=organization_id, user_id=person, endpoint=server, token="tk-1"
    )

    stored = vault.person_rows[(organization_id, person, token_slug(server.id))]
    assert stored.id == row.id
    assert stored.kind == SecretKind.MCP_TOKEN
    assert stored.data.secret.content == "tk-1"
    # A second sign-in replaces the token in the same row.
    again = await service.sign_in_with_token(
        organization_id=organization_id, user_id=person, endpoint=server, token="tk-2"
    )
    assert again.id == row.id
    assert len(vault.person_rows) == 1


@pytest.mark.asyncio
async def test_a_person_signs_out_of_their_own_row_only():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.API_KEY)
    organization_id, me, colleague = uuid4(), uuid4(), uuid4()
    for person in (me, colleague):
        await service.sign_in_with_token(
            organization_id=organization_id, user_id=person, endpoint=server, token="t"
        )

    assert await service.sign_out(
        organization_id=organization_id, user_id=me, endpoint=server
    )
    # Idempotent: signing out again changes nothing and is no error.
    assert not await service.sign_out(
        organization_id=organization_id, user_id=me, endpoint=server
    )
    assert list(vault.person_rows) == [
        (organization_id, colleague, token_slug(server.id))
    ]


@pytest.mark.asyncio
async def test_signing_out_of_an_oauth_server_deletes_the_persons_grant():
    service, vault, _ = _service()
    server = _server(MCPAuthScheme.OAUTH)
    organization_id, person = uuid4(), uuid4()
    vault.person_rows[(organization_id, person, grant_slug(server.id))] = _grant_row(
        slug=grant_slug(server.id), expires_at=None, refresh_token=None
    )

    assert await service.sign_out(
        organization_id=organization_id, user_id=person, endpoint=server
    )
    assert vault.person_rows == {}


@pytest.mark.asyncio
async def test_the_sign_ins_of_many_servers_are_read_in_one_call():
    service, vault, _ = _service()
    oauth, token, open_server = (
        _server(MCPAuthScheme.OAUTH),
        _server(MCPAuthScheme.API_KEY),
        _server(MCPAuthScheme.NONE),
    )
    organization_id, person = uuid4(), uuid4()
    await service.sign_in_with_token(
        organization_id=organization_id, user_id=person, endpoint=token, token="t"
    )
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
    server = _server(MCPAuthScheme.API_KEY)
    organization_id = uuid4()
    for person in (uuid4(), uuid4()):
        await service.sign_in_with_token(
            organization_id=organization_id, user_id=person, endpoint=server, token="t"
        )

    deleted = await service.delete_sign_ins(
        organization_id=organization_id,
        project_id=uuid4(),
        slugs=[token_slug(server.id)],
    )

    assert deleted == 2
    assert vault.person_rows == {}
