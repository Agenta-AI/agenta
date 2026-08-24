"""MCP OAuth service integration against the reusable local provider fixture."""

from uuid import uuid4

import pytest


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def test_local_provider_exchange_persists_a_handle_and_reconnect_reuses_it(
    local_mcp_oauth_provider, local_mcp_oauth_connect_service
):
    service, dao = local_mcp_oauth_connect_service
    project_id, user_id = uuid4(), uuid4()

    discovery = await service.discover(server_url=local_mcp_oauth_provider.server_url)
    assert (
        discovery.authorization_server == local_mcp_oauth_provider.authorization_server
    )
    assert discovery.authorization_endpoint == local_mcp_oauth_provider.authorize_url

    first_start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )
    first = await service.complete(
        **local_mcp_oauth_provider.callback_params(state=first_start.state)
    )

    assert first.secret_id is not None
    assert "access_token" not in first.model_dump(mode="json")
    assert "refresh_token" not in first.model_dump(mode="json")

    second_start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )
    second = await service.complete(
        **local_mcp_oauth_provider.callback_params(state=second_start.state)
    )

    grants = [record for _, record in dao.records if record.kind.value == "oauth_grant"]
    assert len(grants) == 1
    assert second.secret_id == first.secret_id == grants[0].id
