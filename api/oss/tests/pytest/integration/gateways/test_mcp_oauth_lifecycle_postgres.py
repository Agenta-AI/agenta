"""The OAuth attempt lifecycle on the production DAOs, against real Postgres.

The unit suites run the same service over in-memory fakes, which cannot show what a
shared, task-scoped session does to a lock held across nested DAO calls. These cases use
the real attempt, endpoint and vault DAOs, and pause one side of each race on purpose.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import text

from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthAttemptStatus
from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
from oss.src.core.gateways.mcps.oauth.storage import grant_slug
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthAttemptCancelledError
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import LLMStandardProviderKind, SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Header
from oss.src.dbs.postgres.gateways.mcps import dao as endpoints_dao_module
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.gateways.mcps.oauth_dao import MCPOAuthAttemptsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.integration]

_NEW_URL = "https://mcp.moved.local/"


@pytest.fixture
def services(local_mcp_oauth_provider, _public_dns_for_the_oauth_provider):
    endpoints = MCPEndpointsDAO(engine=get_transactions_engine())
    vault = VaultService(secrets_dao=SecretsDAO())
    connect = MCPOAuthConnectService(
        vault_service=vault,
        client=MCPOAuthClient(transport=local_mcp_oauth_provider.transport),
        api_url="https://api.oauth.local",
        attempts_dao=MCPOAuthAttemptsDAO(),
        endpoints_dao=endpoints,
        resolve=lambda _hostname: ["10.0.0.1"],
    )
    resolver = SecretsResolver(vault_service=vault)
    gateway = MCPGatewayService(
        mcp_endpoints_dao=endpoints,
        policy=GatewayPolicyService(resolver=resolver),
        resolver=resolver,
        connections_service=ConnectionsService(
            connections_dao=None,  # type: ignore[arg-type]
            adapter_registry=None,  # type: ignore[arg-type]
        ),
        upstream_registry=MCPUpstreamRegistry(adapters={}),
        oauth_refresher=connect,
    )
    return connect, gateway, endpoints


async def _connection(endpoints, project, provider, slug):
    return await endpoints.create_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointCreate(
            slug=slug,
            name=slug,
            auth_mode=MCPAuthScheme.OAUTH,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=provider.server_url)),
        ),
    )


async def _claimed(connect, project, provider, endpoint):
    start = await connect.begin(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=endpoint.id,
        server_url=provider.server_url,
        scopes=["tools:call"],
    )
    attempt = await connect.claim(state=start.state, caller_user_id=project["user_id"])
    code = provider.callback_params(state=start.state)["code"]
    return start, attempt, code


async def _status(connect, project, endpoint, start):
    outcome = await connect.outcome(
        project_id=project["project_id"],
        endpoint_id=endpoint.id,
        attempt_id=start.attempt_id,
    )
    return outcome.status


async def _grant_ids(project, endpoint_id: UUID):
    async with get_transactions_engine().session() as session:
        rows = await session.execute(
            text("SELECT id FROM secrets WHERE project_id = :p AND slug = :s"),
            {"p": project["project_id"], "s": grant_slug(endpoint_id)},
        )
        return [row[0] for row in rows]


async def _edit(gateway, project, endpoint, **changes):
    current = await gateway.fetch_endpoint(
        project_id=project["project_id"], endpoint_id=endpoint.id
    )
    return await gateway.edit_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointEdit(
            id=current.id,
            name=current.name,
            auth_mode=changes.get("auth_mode", current.auth_mode),
            secret_id=changes.get("secret_id", current.secret_id),
            data=current.data.model_copy(
                update={
                    "route": MCPEndpointRoute(
                        base_url=changes.get("base_url", current.data.route.base_url)
                    )
                }
            ),
        ),
    )


def _pause_after(owner, name):
    """Hold the next call of `owner.name` after it returns, until the test lets it go."""
    reached, release = asyncio.Event(), asyncio.Event()
    original = getattr(owner, name)

    async def paused(*args, **kwargs):
        result = await original(*args, **kwargs)
        if not reached.is_set():
            reached.set()
            await release.wait()
        return result

    setattr(owner, name, paused)
    return reached, release


@pytest.mark.asyncio
async def test_a_successful_completion_persists_connected(
    services, project, local_mcp_oauth_provider
):
    connect, _gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-success"
    )
    start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )

    completion = await connect.complete(attempt=attempt, code=code)

    assert await _status(connect, project, endpoint, start) == (
        MCPOAuthAttemptStatus.CONNECTED
    )
    bound = await endpoints.fetch_endpoint(
        project_id=project["project_id"], endpoint_id=endpoint.id
    )
    assert bound.secret_id == completion.secret_id
    assert await _grant_ids(project, endpoint.id) == [completion.secret_id]


@pytest.mark.asyncio
async def test_a_cancel_cannot_commit_inside_a_finalization_with_nested_reads(
    services, project, local_mcp_oauth_provider
):
    """The nested endpoint read commits its own session. The attempt lock must survive
    it, so a cancel arriving then waits, and finds a finished attempt."""
    connect, _gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-nested"
    )
    start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )
    reached, release = _pause_after(connect.endpoints_dao, "fetch_endpoint")

    completing = asyncio.create_task(connect.complete(attempt=attempt, code=code))
    await reached.wait()
    cancelling = asyncio.create_task(
        connect.cancel(project_id=project["project_id"], endpoint_id=endpoint.id)
    )
    await asyncio.sleep(0.3)
    assert not cancelling.done()
    release.set()

    await completing
    assert await cancelling == 0
    assert await _status(connect, project, endpoint, start) == (
        MCPOAuthAttemptStatus.CONNECTED
    )


@pytest.mark.asyncio
async def test_a_cancel_before_finalization_wins(
    services, project, local_mcp_oauth_provider
):
    connect, _gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-cancel"
    )
    start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )

    await connect.cancel(
        project_id=project["project_id"],
        endpoint_id=endpoint.id,
        attempt_id=start.attempt_id,
    )
    with pytest.raises(MCPOAuthAttemptCancelledError):
        await connect.complete(attempt=attempt, code=code)

    assert await _grant_ids(project, endpoint.id) == []
    assert await _status(connect, project, endpoint, start) == (
        MCPOAuthAttemptStatus.CANCELLED
    )


@pytest.mark.asyncio
async def test_an_edit_during_finalization_leaves_a_cancelled_attempt_and_no_grant(
    services, project, local_mcp_oauth_provider
):
    """Finalization holds the attempt lock and has read the old address. An edit then
    commits a new address. Finalization resumes: its bind is refused, the tokens it
    wrote go, and the edit's state stands."""
    connect, gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-edit-mid"
    )
    start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )
    reached, release = _pause_after(connect.endpoints_dao, "fetch_endpoint")

    completing = asyncio.create_task(connect.complete(attempt=attempt, code=code))
    await reached.wait()
    editing = asyncio.create_task(_edit(gateway, project, endpoint, base_url=_NEW_URL))
    for _ in range(50):
        moved = await endpoints.fetch_endpoint(
            project_id=project["project_id"], endpoint_id=endpoint.id
        )
        if moved.data.route.base_url == _NEW_URL:
            break
        await asyncio.sleep(0.05)
    release.set()

    with pytest.raises(MCPOAuthAttemptCancelledError):
        await completing
    edited = await editing

    assert await _status(connect, project, endpoint, start) == (
        MCPOAuthAttemptStatus.CANCELLED
    )
    assert await _grant_ids(project, endpoint.id) == []
    assert edited.data.route.base_url == _NEW_URL
    assert edited.secret_id is None


@pytest.mark.asyncio
async def test_a_reader_during_an_address_edit_never_sees_the_new_address_with_the_old_grant(
    services, project, local_mcp_oauth_provider, monkeypatch
):
    connect, gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-edit-read"
    )
    _start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )
    completion = await connect.complete(attempt=attempt, code=code)

    reached, release = asyncio.Event(), asyncio.Event()
    original_check = endpoints_dao_module.check_secret_is_owned_by_project

    async def paused_check(*args, **kwargs):
        await original_check(*args, **kwargs)
        reached.set()
        await release.wait()

    monkeypatch.setattr(
        endpoints_dao_module, "check_secret_is_owned_by_project", paused_check
    )

    editing = asyncio.create_task(_edit(gateway, project, endpoint, base_url=_NEW_URL))
    await reached.wait()
    during = await endpoints.fetch_endpoint(
        project_id=project["project_id"], endpoint_id=endpoint.id
    )
    release.set()
    await editing
    after = await endpoints.fetch_endpoint(
        project_id=project["project_id"], endpoint_id=endpoint.id
    )

    # A relay reads the row as one of these two, never a mix.
    assert (during.data.route.base_url, during.secret_id) == (
        local_mcp_oauth_provider.server_url,
        completion.secret_id,
    )
    assert (after.data.route.base_url, after.secret_id) == (_NEW_URL, None)
    assert await _grant_ids(project, endpoint.id) == []


@pytest.mark.asyncio
async def test_a_switch_to_an_api_key_during_an_address_edits_cleanup_keeps_its_key(
    services, project, local_mcp_oauth_provider
):
    """Edit A moves the address and pauses before it retires the old grant. Edit B
    switches the connection to an API key with the person's own secret. A then
    finishes, and B's secret is still the one bound."""
    connect, gateway, endpoints = services
    endpoint = await _connection(
        endpoints, project, local_mcp_oauth_provider, "pg-edit-race"
    )
    _start, attempt, code = await _claimed(
        connect, project, local_mcp_oauth_provider, endpoint
    )
    await connect.complete(attempt=attempt, code=code)
    key = (
        await connect.vault_service.create_secret(
            project_id=project["project_id"],
            create_secret_dto=CreateSecretDTO(
                slug="pg-edit-race-key",
                header=Header(name="b-key"),
                secret=SecretDTO(
                    kind=SecretKind.PROVIDER_KEY,
                    data=StandardProviderDTO(
                        kind=LLMStandardProviderKind.OPENAI,
                        provider=StandardProviderSettingsDTO(key="test-key-one"),
                    ),
                ),
            ),
        )
    ).id

    reached, release = asyncio.Event(), asyncio.Event()
    original_release = connect.release_grant

    async def paused_release(**kwargs):
        reached.set()
        await release.wait()
        await original_release(**kwargs)

    connect.release_grant = paused_release

    editing_a = asyncio.create_task(
        _edit(gateway, project, endpoint, base_url=_NEW_URL)
    )
    await reached.wait()
    connect.release_grant = original_release
    await _edit(
        gateway,
        project,
        endpoint,
        auth_mode=MCPAuthScheme.API_KEY,
        secret_id=key,
    )
    release.set()
    await editing_a

    final = await endpoints.fetch_endpoint(
        project_id=project["project_id"], endpoint_id=endpoint.id
    )
    assert final.auth_mode == MCPAuthScheme.API_KEY
    assert final.secret_id == key
    assert await _grant_ids(project, endpoint.id) == []
