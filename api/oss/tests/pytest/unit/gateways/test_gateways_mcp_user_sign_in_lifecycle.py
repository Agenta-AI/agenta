"""Every owner's sign-ins go when a server changes its mode or address, or is deleted.

A person's grant was issued for the server's address, and a token for its mode. Left in
place, an edit would send a person's grant to a new address, or keep a token the server no
longer reads. These rows are deleted for the project and every person in one call.
"""

from uuid import uuid4

import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.storage import grant_slug, token_slug
from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
    MockMCPEndpointsDAO,
    _ReleasingRefresher,
    _relay_service,
)

URL = "https://mcp.acme.io/"


async def _setup(auth_mode):
    dao = MockMCPEndpointsDAO()
    refresher = _ReleasingRefresher()
    service = _relay_service(
        mcp_endpoints_dao=dao, adapters={}, oauth_refresher=refresher
    )
    project_id = uuid4()
    endpoint = await service.create_endpoint(
        project_id=project_id,
        user_id=uuid4(),
        endpoint=MCPEndpointCreate(
            slug="acme",
            name="Acme",
            auth_mode=auth_mode,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=URL)),
        ),
    )
    return service, refresher, project_id, endpoint


async def _edit(service, project_id, endpoint, *, auth_mode, url=URL, name="Acme"):
    return await service.edit_endpoint(
        organization_id=uuid4(),
        project_id=project_id,
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=endpoint.id,
            name=name,
            auth_mode=auth_mode,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=url)),
        ),
    )


@pytest.mark.asyncio
async def test_an_oauth_server_moved_to_a_token_loses_every_grant():
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.OAUTH)

    await _edit(service, project_id, endpoint, auth_mode=MCPAuthScheme.API_KEY)

    assert refresher.deleted_sign_ins == [grant_slug(endpoint.id)]


@pytest.mark.asyncio
async def test_a_token_server_moved_to_oauth_loses_every_token():
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.API_KEY)

    await _edit(service, project_id, endpoint, auth_mode=MCPAuthScheme.OAUTH)

    assert refresher.deleted_sign_ins == [token_slug(endpoint.id)]


@pytest.mark.asyncio
async def test_an_oauth_server_at_a_new_address_loses_every_grant():
    """A grant must never reach an address it was not issued for."""
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.OAUTH)

    await _edit(
        service,
        project_id,
        endpoint,
        auth_mode=MCPAuthScheme.OAUTH,
        url="https://elsewhere.example/mcp",
    )

    assert refresher.deleted_sign_ins == [grant_slug(endpoint.id)]


@pytest.mark.asyncio
async def test_a_rename_keeps_every_sign_in():
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.OAUTH)

    await _edit(
        service, project_id, endpoint, auth_mode=MCPAuthScheme.OAUTH, name="Acme 2"
    )

    assert refresher.deleted_sign_ins == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "auth_mode", [MCPAuthScheme.OAUTH, MCPAuthScheme.API_KEY, MCPAuthScheme.NONE]
)
async def test_deleting_a_server_deletes_every_sign_in(auth_mode):
    service, refresher, project_id, endpoint = await _setup(auth_mode)

    assert await service.delete_endpoint(
        organization_id=uuid4(), project_id=project_id, endpoint_id=endpoint.id
    )

    assert sorted(refresher.deleted_sign_ins) == sorted(
        [grant_slug(endpoint.id), token_slug(endpoint.id)]
    )


@pytest.mark.asyncio
async def test_a_token_server_at_a_new_address_loses_every_token():
    """Otherwise an editor could point the server at their own address and receive each
    person's token on that person's next run."""
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.API_KEY)

    await _edit(
        service,
        project_id,
        endpoint,
        auth_mode=MCPAuthScheme.API_KEY,
        url="https://elsewhere.example/mcp",
    )

    assert refresher.deleted_sign_ins == [token_slug(endpoint.id)]
