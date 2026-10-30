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


@pytest.mark.asyncio
async def test_the_old_sign_ins_go_before_the_new_address_is_written():
    """A relay reads the server, then the sign-in, without the server's lock. If the new
    address were written first, a relay in between could send an old token to it."""
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.API_KEY)
    order = []
    dao = service.mcp_endpoints_dao
    original_edit = dao.edit_endpoint

    async def edit_endpoint(**kwargs):
        order.append("edit")
        return await original_edit(**kwargs)

    original_delete = refresher.delete_sign_ins

    async def delete_sign_ins(**kwargs):
        order.append("delete_sign_ins")
        return await original_delete(**kwargs)

    dao.edit_endpoint = edit_endpoint
    refresher.delete_sign_ins = delete_sign_ins

    await _edit(
        service,
        project_id,
        endpoint,
        auth_mode=MCPAuthScheme.API_KEY,
        url="https://elsewhere.example/mcp",
    )

    assert order == ["delete_sign_ins", "edit"]


@pytest.mark.asyncio
async def test_a_moved_oauth_server_stops_naming_the_grant_it_retired():
    """The edit is a full PUT that may still carry the server's grant id. That grant is
    deleted before the write, so the write must not be asked to keep it."""
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.OAUTH)
    grant_id = uuid4()
    dao = service.mcp_endpoints_dao
    dao._by_id[endpoint.id] = endpoint.model_copy(update={"secret_id": grant_id})
    written = []
    original_edit = dao.edit_endpoint

    async def edit_endpoint(**kwargs):
        written.append(kwargs["endpoint"])
        return await original_edit(**kwargs)

    dao.edit_endpoint = edit_endpoint

    await service.edit_endpoint(
        organization_id=uuid4(),
        project_id=project_id,
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=endpoint.id,
            name="Acme",
            auth_mode=MCPAuthScheme.OAUTH,
            secret_id=grant_id,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://elsewhere.example/mcp")
            ),
        ),
    )

    assert refresher.deleted_sign_ins == [grant_slug(endpoint.id)]
    assert written[0].secret_id is None


@pytest.mark.asyncio
async def test_a_moved_token_server_keeps_the_projects_own_key():
    """The project's key is a secret the admin picked, not a sign-in: it stays named."""
    service, refresher, project_id, endpoint = await _setup(MCPAuthScheme.API_KEY)
    key_id = uuid4()
    dao = service.mcp_endpoints_dao
    written = []
    original_edit = dao.edit_endpoint

    async def edit_endpoint(**kwargs):
        written.append(kwargs["endpoint"])
        return await original_edit(**kwargs)

    dao.edit_endpoint = edit_endpoint

    await service.edit_endpoint(
        organization_id=uuid4(),
        project_id=project_id,
        user_id=uuid4(),
        endpoint=MCPEndpointEdit(
            id=endpoint.id,
            name="Acme",
            auth_mode=MCPAuthScheme.API_KEY,
            secret_id=key_id,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url="https://elsewhere.example/mcp")
            ),
        ),
    )

    assert written[0].secret_id == key_id
