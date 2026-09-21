"""Recovering an MCP connection whose credential stopped working, against real Postgres.

A credential dies in more than one way, and only one of them is visible from inside this
deployment. A grant whose recorded expiry has passed can be renewed, and the relay does
that already. The rest — a person removing the application at the provider, an
administrator revoking an account's authorization, a renewal handle withdrawn on its own,
a server that stops answering mid-call — arrive as an upstream answer the gateway did not
ask for. Each of these cases drives the whole relay through one of those endings and
asserts on two things: what the caller is told, and what state the connection is left in.

The state half is the reason for real Postgres. What a person sees on the settings screen
is `mcps_endpoints.flags.is_valid` and the presence of a grant row, so a case that checks
reconnect is checking rows; an in-memory double would agree with whatever the service
wrote. Credential resolution is real too — the real vault, the real resolver, the real
connect service — because the recovery paths are exactly the ones that read and rewrite a
grant, and the whole question is which row they touch.

Two things are stood in for. The authorization decision is held allowed: RBAC needs a
project membership graph that says nothing about recovery, and the permission mapping has
its own tests. And the upstream is `LocalMCPOAuthProvider` from `conftest.py`, one object
serving both the authorization server and the MCP server it protects, over an injected
transport rather than a socket. Its `revoke()` and `times_out` switches are what let a
case ask for an ending this deployment cannot otherwise produce.
"""

from __future__ import annotations

import asyncio
import json
from typing import List, Optional
from unittest.mock import AsyncMock

import httpx
import pytest
from mcp.shared.auth import OAuthToken

from oss.src.apis.fastapi.gateways.mcps.proxy import _map_gateway_exception
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.dtos import (
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPCallContext,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage, grant_slug
from oss.src.core.gateways.mcps.providers.http.adapter import HttpMCPAdapter
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthRefreshFailedError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.context import AuthScope

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


# --- the deployment under test ----------------------------------------------- #


@pytest.fixture
def _allow_every_caller(monkeypatch):
    """Hold the authorization decision allowed.

    Only the verdict is stood in for. The decision object, the audit record built from it
    and every other layer below stay real; what RBAC would otherwise need is a project
    membership graph that says nothing about credential recovery.
    """
    monkeypatch.setattr(
        "oss.src.core.gateways.policy.service.check_action_access",
        AsyncMock(return_value=True),
    )


@pytest.fixture(autouse=True)
def published_events(monkeypatch) -> List:
    """Every audit event the relay publishes, with the publisher's transport replaced.

    `publish_gateway_call` swallows its own failures, so a real Redis would hide a broken
    record rather than report one. Patching the last call before the transport keeps the
    attribute building real and makes what was recorded assertable.

    Autouse so that no case here depends on a reachable event stream: recovery is what
    these tests are about, and a relay whose audit publish fails must still relay.
    """
    recorded: List = []

    async def _capture(**kwargs):
        recorded.append(kwargs["event"])

    monkeypatch.setattr("oss.src.core.events.utils.publish_event", _capture)
    return recorded


@pytest.fixture
def relay_service(
    local_mcp_oauth_provider,
    connect_service,
    _allow_every_caller,
    _public_dns_for_the_oauth_provider,
) -> MCPGatewayService:
    """The relay as a deployment wires it, with the provider standing in for the socket."""
    resolver = SecretsResolver(vault_service=VaultService(secrets_dao=SecretsDAO()))
    return MCPGatewayService(
        mcp_endpoints_dao=MCPEndpointsDAO(engine=get_transactions_engine()),
        policy=GatewayPolicyService(resolver=resolver),
        resolver=resolver,
        # Brokered integrations are a different namespace; a custom connection never
        # reaches this service, so it is constructed without its collaborators rather
        # than given doubles that would only be a second thing to keep true.
        connections_service=ConnectionsService(
            connections_dao=None,  # type: ignore[arg-type]
            adapter_registry=None,  # type: ignore[arg-type]
        ),
        upstream_registry=MCPUpstreamRegistry(
            adapters={
                "http": HttpMCPAdapter(transport=local_mcp_oauth_provider.transport)
            }
        ),
        oauth_refresher=connect_service,
    )


# --- driving one connection -------------------------------------------------- #


def _dao() -> MCPEndpointsDAO:
    return MCPEndpointsDAO(engine=get_transactions_engine())


def _scope(project) -> AuthScope:
    return AuthScope(
        organization_id=project["organization_id"],
        workspace_id=project["workspace_id"],
        project_id=project["project_id"],
        user_id=project["user_id"],
    )


async def _create_connection(*, project, slug: str, name: str, base_url: str):
    return await _dao().create_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointCreate(
            slug=slug,
            name=name,
            auth_mode=MCPAuthScheme.OAUTH,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=base_url)),
        ),
    )


async def _consent(*, service, provider, project, endpoint):
    """One complete consent, then the row update the callback performs.

    The bind is the DAO's own credential transition, the one the callback route performs:
    two columns, and it is what decides that a new grant makes a connection valid again,
    which is the behaviour every reconnect case below turns on.
    """
    start = await service.begin(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=endpoint.id,
        server_url=provider.server_url,
        scopes=["tools:call"],
    )
    attempt = await service.claim(state=start.state, caller_user_id=project["user_id"])
    completion = await service.complete(
        attempt=attempt,
        code=provider.callback_params(state=start.state)["code"],
    )
    return await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=endpoint.id,
        secret_id=completion.secret_id,
    )


async def _disconnect(*, project, connect_service, connection):
    """Drop a connection's grant and clear its handle, the way the route does.

    Both halves belong to one operation, and a test that dropped only the vault row would
    leave the connection naming a grant nothing holds, which is a different case.
    """
    await connect_service.disconnect(
        project_id=project["project_id"],
        endpoint_id=connection.id,
        server_url=connection.data.route.base_url,
    )
    return await _dao().bind_endpoint_secret(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        secret_id=None,
    )


async def _connected(*, project, connect_service, provider, slug, name):
    """A connection that exists, has consented, and relays."""
    endpoint = await _create_connection(
        project=project, slug=slug, name=name, base_url=provider.server_url
    )
    return await _consent(
        service=connect_service, provider=provider, project=project, endpoint=endpoint
    )


async def _call(service, project, connection, *, tool: str = "echo"):
    return await service.relay(
        scope=_scope(project),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name=connection.slug,
        context=MCPCallContext(method="tools/call", target=tool),
        body=json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": {}},
            }
        ).encode(),
        headers={},
    )


async def _reload(project, connection):
    return await _dao().fetch_endpoint(
        project_id=project["project_id"], endpoint_id=connection.id
    )


async def _grants(*, project) -> List:
    vault = VaultService(secrets_dao=SecretsDAO())
    return [
        secret
        for secret in await vault.list_secrets(project_id=project["project_id"])
        if secret.kind == SecretKind.OAUTH_GRANT
    ]


def _storage(*, project, provider, endpoint_id, issuer: Optional[str] = None):
    return SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project["project_id"],
        server_url=provider.server_url,
        endpoint_id=endpoint_id,
        authorization_server=issuer,
    )


async def _age_the_grant(*, project, provider, endpoint_id):
    """Push a stored grant past its recorded expiry, the way time does.

    Rewritten through a storage carrying the grant's own issuer pin, because a renewal
    refuses a grant that does not record who issued it.
    """
    storage = _storage(project=project, provider=provider, endpoint_id=endpoint_id)
    grant = await storage.get_grant()
    assert grant is not None
    await _storage(
        project=project,
        provider=provider,
        endpoint_id=endpoint_id,
        issuer=grant.issuer,
    ).write_tokens(
        OAuthToken(
            access_token=grant.access_token,
            token_type="Bearer",
            expires_in=-3600,
            refresh_token=grant.refresh_token,
            scope=" ".join(grant.scopes) if grant.scopes else None,
        )
    )
    return grant


def _envelope(exception: BaseException) -> dict:
    """What the caller actually receives, through the proxy's own mapping."""
    response = _map_gateway_exception(exception)
    return json.loads(response.body)


async def _connection_state(service, project, connection) -> GatewayConnectionState:
    endpoints = await service.query_endpoints(project_id=project["project_id"])
    listed = next(e for e in endpoints if e.id == connection.id)
    return await service._connection_state(  # noqa: SLF001 - the state the UI reads
        project_id=project["project_id"], user_id=project["user_id"], endpoint=listed
    )


# --- a connection holding no authorization at all ---------------------------- #


async def test_a_connection_that_never_consented_is_told_how_to_connect(
    project, relay_service, local_mcp_oauth_provider
):
    """The state every OAuth connection starts in. The refusal has to carry the action
    that ends it, or an agent is told a credential is missing with no way to supply one.
    """
    connection = await _create_connection(
        project=project,
        slug="never-connected",
        name="Acme",
        base_url=local_mcp_oauth_provider.server_url,
    )

    with pytest.raises(MCPAuthRequiredError) as excinfo:
        await _call(relay_service, project, connection)

    envelope = _envelope(excinfo.value)
    assert envelope["error"]["data"]["cause"] == "auth_required"
    requirement = envelope["error"]["data"]["requirement"]
    assert requirement["state"] == "needs_auth"
    assert requirement["connect"]["endpoint"] == (
        f"/gateways/mcps/endpoints/{connection.id}/connect"
    )
    # Nothing is wrong with the connection; it simply holds no authorization.
    assert (await _reload(project, connection)).flags.is_valid is True
    assert (
        await _connection_state(relay_service, project, connection)
        == GatewayConnectionState.NEEDS_AUTH
    )
    assert await _grants(project=project) == []


async def test_a_disconnected_connection_is_told_how_to_connect_again(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """Pressing Disconnect and then running an agent is the ordinary way to reach this,
    and it used to answer `secret_missing` with no action at all."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="disconnected",
        name="Acme",
    )
    assert (await _call(relay_service, project, connection)).status_code == 200

    await _disconnect(
        project=project, connect_service=connect_service, connection=connection
    )

    with pytest.raises(MCPAuthRequiredError) as excinfo:
        await _call(relay_service, project, await _reload(project, connection))

    envelope = _envelope(excinfo.value)
    assert envelope["error"]["data"]["cause"] == "auth_required"
    assert envelope["error"]["data"]["requirement"]["connect"]["endpoint"] == (
        f"/gateways/mcps/endpoints/{connection.id}/connect"
    )
    assert await _grants(project=project) == []


async def test_a_disconnected_connection_works_again_after_following_the_action(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """The affordance is only worth carrying if following it is the whole cure."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="disconnected-reconnects",
        name="Acme",
    )
    await _disconnect(
        project=project, connect_service=connect_service, connection=connection
    )

    reconnected = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project=project,
        endpoint=await _reload(project, connection),
    )

    assert (await _call(relay_service, project, reconnected)).status_code == 200
    grants = await _grants(project=project)
    assert len(grants) == 1
    assert grants[0].slug == grant_slug(connection.id)


async def test_disconnecting_one_connection_does_not_refuse_another_at_the_same_url(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    project_provider = local_mcp_oauth_provider
    dropped = await _connected(
        project=project,
        connect_service=connect_service,
        provider=project_provider,
        slug="dropped",
        name="Acme, work",
    )
    kept = await _connected(
        project=project,
        connect_service=connect_service,
        provider=project_provider,
        slug="kept",
        name="Acme, personal",
    )

    await _disconnect(
        project=project, connect_service=connect_service, connection=dropped
    )

    with pytest.raises(MCPAuthRequiredError):
        await _call(relay_service, project, await _reload(project, dropped))
    assert (await _call(relay_service, project, kept)).status_code == 200


# --- a credential the provider retired --------------------------------------- #


async def test_a_revoked_credential_asks_for_a_reconnect_rather_than_relaying_a_401(
    project, relay_service, connect_service, local_mcp_oauth_provider, published_events
):
    """OR83. The stored grant's recorded expiry is still in the future, so nothing renews
    it and the relay sends a token the provider has stopped honouring."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="revoked",
        name="Acme",
    )
    assert (await _call(relay_service, project, connection)).status_code == 200

    local_mcp_oauth_provider.revoke()

    with pytest.raises(MCPAuthRequiredError) as excinfo:
        await _call(relay_service, project, connection)

    envelope = _envelope(excinfo.value)
    assert envelope["error"]["data"]["cause"] == "auth_required"
    requirement = envelope["error"]["data"]["requirement"]
    assert requirement["state"] == "needs_auth"
    assert requirement["connect"]["endpoint"] == (
        f"/gateways/mcps/endpoints/{connection.id}/connect"
    )

    # And the connection says so where a person would look.
    assert (await _reload(project, connection)).flags.is_valid is False
    assert (
        await _connection_state(relay_service, project, connection)
        == GatewayConnectionState.NEEDS_AUTH
    )

    # The refusal is a recorded ending, not a silent one.
    refusal = published_events[-1].attributes
    assert refusal["status_code"] == 401
    assert refusal["method"] == "tools/call"
    assert refusal["tool"] == "echo"


async def test_a_revoked_connection_recovers_by_consenting_again(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """Reconnect is the whole cure, and it must not need anything else undone first."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="revoked-recovers",
        name="Acme",
    )
    local_mcp_oauth_provider.revoke()
    with pytest.raises(MCPAuthRequiredError):
        await _call(relay_service, project, connection)

    reconnected = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project=project,
        endpoint=await _reload(project, connection),
    )

    assert reconnected.flags.is_valid is True
    assert (await _call(relay_service, project, reconnected)).status_code == 200
    # The connection kept its identity, so one grant row under one slug.
    grants = await _grants(project=project)
    assert len(grants) == 1
    assert grants[0].slug == grant_slug(connection.id)


async def test_a_revoked_credential_does_not_touch_another_account_at_the_same_url(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """Revocation at the provider is per account. One connection failing must not mark
    the other invalid, and must not cost it its grant."""
    revoked = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="pair-revoked",
        name="Acme, work",
    )
    survivor = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="pair-survivor",
        name="Acme, personal",
    )
    survivor_grant = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=survivor.id
    ).get_grant()
    assert survivor_grant is not None

    # Retire only the first connection's access token, the way a provider revokes one
    # account's authorization while the other's keeps working.
    revoked_grant = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=revoked.id
    ).get_grant()
    assert revoked_grant is not None
    local_mcp_oauth_provider.revoke_access_token(revoked_grant.access_token)

    with pytest.raises(MCPAuthRequiredError):
        await _call(relay_service, project, revoked)

    assert (await _reload(project, survivor)).flags.is_valid is True
    after = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=survivor.id
    ).get_grant()
    assert after is not None
    assert after.access_token == survivor_grant.access_token
    assert len(await _grants(project=project)) == 2


# --- a grant that expired, and the renewal that follows ---------------------- #


async def test_an_expired_access_token_is_renewed_and_the_call_succeeds(
    project, relay_service, connect_service, local_mcp_oauth_provider, published_events
):
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="expired",
        name="Acme",
    )
    before = await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.token_requests = 0

    result = await _call(relay_service, project, connection)

    assert result.status_code == 200
    assert local_mcp_oauth_provider.token_requests == 1
    after = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    ).get_grant()
    assert after is not None
    assert after.access_token != before.access_token
    assert after.refresh_token != before.refresh_token  # the provider rotates
    # Renewal is invisible to the caller and to the connection's state.
    assert (await _reload(project, connection)).flags.is_valid is True
    assert published_events[-1].attributes["status_code"] == 200
    assert published_events[-1].attributes["duration_ms"] >= 0


async def test_a_renewal_the_provider_refuses_asks_for_a_reconnect(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """A renewal handle withdrawn on its own. Only the connection's owner can replace it,
    so the caller is told to reconnect rather than handed the renewal's own error."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="renewal-refused",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.revoke_renewal_handles()

    with pytest.raises(MCPAuthRequiredError) as excinfo:
        await _call(relay_service, project, connection)

    envelope = _envelope(excinfo.value)
    assert envelope["error"]["data"]["cause"] == "auth_required"
    assert envelope["error"]["data"]["requirement"]["connect"]["endpoint"] == (
        f"/gateways/mcps/endpoints/{connection.id}/connect"
    )
    assert (await _reload(project, connection)).flags.is_valid is False

    # The dead grant is kept rather than deleted. Reconnecting overwrites it under the
    # same slug; deleting it here would make a failed renewal and a disconnect
    # indistinguishable on the row.
    assert len(await _grants(project=project)) == 1


async def test_a_refused_renewal_can_be_retried_without_multiplying_grants(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """Retrying is what a caller does with a failure, so it has to be harmless."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="renewal-retried",
        name="Acme",
    )
    sibling = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="renewal-retried-sibling",
        name="Acme, personal",
    )
    sibling_grant = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=sibling.id
    ).get_grant()
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.revoke_renewal_handles()

    for _ in range(3):
        with pytest.raises(MCPAuthRequiredError):
            await _call(relay_service, project, connection)

    assert len(await _grants(project=project)) == 2
    unchanged = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=sibling.id
    ).get_grant()
    assert unchanged is not None
    assert sibling_grant is not None
    assert unchanged.access_token == sibling_grant.access_token
    assert unchanged.refresh_token == sibling_grant.refresh_token
    assert (await _reload(project, sibling)).flags.is_valid is True


# --- several callers finding the same grant expired at once ------------------ #


async def test_concurrent_calls_on_one_expired_connection_renew_it_once(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """The provider rotates, so a second renewal would spend a handle the first already
    retired and leave one caller holding a dead token. Counting what reached the token
    endpoint is the claim, because a passing relay alone would not distinguish one
    exchange from two that happened to resolve in a lucky order.
    """
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="concurrent",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.token_requests = 0

    results = await asyncio.gather(
        *(_call(relay_service, project, connection) for _ in range(5))
    )

    assert [r.status_code for r in results] == [200] * 5
    assert local_mcp_oauth_provider.token_requests == 1
    assert len(await _grants(project=project)) == 1


async def test_a_renewal_on_one_connection_does_not_serialize_another(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """The lock is per connection, so two accounts at one server renew independently and
    each spends only its own handle."""
    first = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="parallel-a",
        name="Acme, work",
    )
    second = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="parallel-b",
        name="Acme, personal",
    )
    for endpoint_id in (first.id, second.id):
        await _age_the_grant(
            project=project,
            provider=local_mcp_oauth_provider,
            endpoint_id=endpoint_id,
        )
    local_mcp_oauth_provider.token_requests = 0

    results = await asyncio.gather(
        _call(relay_service, project, first),
        _call(relay_service, project, second),
    )

    assert [r.status_code for r in results] == [200, 200]
    # One exchange each, not one shared and not four.
    assert local_mcp_oauth_provider.token_requests == 2
    assert len(await _grants(project=project)) == 2


# --- an upstream that stops answering ---------------------------------------- #


async def test_an_upstream_timeout_is_a_typed_refusal_and_leaves_no_partial_state(
    project, relay_service, connect_service, local_mcp_oauth_provider, published_events
):
    """A timeout says nothing about the credential, so nothing about the connection may
    change: an upstream that is merely slow must not cost anyone a reconnect."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="timeout",
        name="Acme",
    )
    before = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    ).get_grant()
    assert before is not None

    local_mcp_oauth_provider.times_out = True

    with pytest.raises(MCPUpstreamError) as excinfo:
        await _call(relay_service, project, connection)

    envelope = _envelope(excinfo.value)
    assert envelope["error"]["data"]["cause"] == "upstream_error"
    assert envelope["error"]["data"]["target"] == local_mcp_oauth_provider.server_url

    assert (await _reload(project, connection)).flags.is_valid is True
    after = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    ).get_grant()
    assert after is not None
    assert after.access_token == before.access_token
    assert after.refresh_token == before.refresh_token
    assert len(await _grants(project=project)) == 1

    # An ending with no status code still records the call and its duration.
    failed = published_events[-1].attributes
    assert "status_code" not in failed
    assert failed["duration_ms"] >= 0
    assert failed["method"] == "tools/call"


async def test_a_call_retried_after_a_timeout_succeeds_once_the_upstream_answers(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """Retrying is the right response to a timeout, and nothing about the first attempt
    may stand in its way."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="timeout-retried",
        name="Acme",
    )
    local_mcp_oauth_provider.times_out = True
    for _ in range(3):
        with pytest.raises(MCPUpstreamError):
            await _call(relay_service, project, connection)

    local_mcp_oauth_provider.times_out = False

    assert (await _call(relay_service, project, connection)).status_code == 200
    assert len(await _grants(project=project)) == 1


async def test_a_timeout_during_a_renewal_leaves_the_grant_renewable(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """The renewal succeeded and the call it was for did not. The new tokens are already
    written, so the retry must use them rather than trying to renew a second time and
    spending a handle the provider has retired."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="timeout-mid-renewal",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.times_out = True
    local_mcp_oauth_provider.token_requests = 0

    with pytest.raises(MCPUpstreamError):
        await _call(relay_service, project, connection)

    assert local_mcp_oauth_provider.token_requests == 1

    local_mcp_oauth_provider.times_out = False
    assert (await _call(relay_service, project, connection)).status_code == 200
    # No second exchange: the retry found a live grant.
    assert local_mcp_oauth_provider.token_requests == 1
    assert len(await _grants(project=project)) == 1


# --- a consent that was already in flight when the account was revoked -------- #


async def test_disconnecting_stops_a_consent_that_was_already_in_flight(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """D5. The browser tab was opened before the person pressed Disconnect. Its callback
    used to complete against the record it was issued and reconnect the account, and
    nothing told the person who thought they had revoked it."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="in-flight-consent",
        name="Acme",
    )

    # A second consent is begun and left mid-flight: the browser has the handle, and
    # the callback has not come back yet.
    start = await connect_service.begin(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=connection.id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )

    await _disconnect(
        project=project, connect_service=connect_service, connection=connection
    )

    # Now the tab comes back. The handle it holds names a record that is gone.
    with pytest.raises(MCPOAuthStateInvalidError):
        await connect_service.claim(
            state=start.state, caller_user_id=project["user_id"]
        )

    assert await _grants(project=project) == []
    assert (await _reload(project, connection)).secret_id is None
    with pytest.raises(MCPAuthRequiredError):
        await _call(relay_service, project, await _reload(project, connection))


async def test_disconnecting_one_connection_leaves_anothers_consent_in_flight(
    project, connect_service, local_mcp_oauth_provider
):
    """Only this connection's consents go. A person disconnecting one account must not
    cancel the consent they are part-way through for another."""
    dropped = await _create_connection(
        project=project,
        slug="drop-me",
        name="Acme, work",
        base_url=local_mcp_oauth_provider.server_url,
    )
    other = await _create_connection(
        project=project,
        slug="keep-me",
        name="Acme, personal",
        base_url=local_mcp_oauth_provider.server_url,
    )
    for endpoint in (dropped, other):
        await connect_service.begin(
            project_id=project["project_id"],
            user_id=project["user_id"],
            endpoint_id=endpoint.id,
            server_url=local_mcp_oauth_provider.server_url,
            scopes=["tools:call"],
        )
    other_start = await connect_service.begin(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint_id=other.id,
        server_url=local_mcp_oauth_provider.server_url,
        scopes=["tools:call"],
    )

    await _disconnect(
        project=project, connect_service=connect_service, connection=dropped
    )

    # The other connection's consent still completes.
    attempt = await connect_service.claim(
        state=other_start.state, caller_user_id=project["user_id"]
    )
    completion = await connect_service.complete(
        attempt=attempt,
        code=local_mcp_oauth_provider.callback_params(state=other_start.state)["code"],
    )
    assert completion.endpoint_id == other.id
    assert len(await _grants(project=project)) == 1


# --- the refresh lock does not accumulate ------------------------------------ #


async def test_the_refresh_lock_is_released_and_forgotten_after_a_renewal(
    project, connect_service, local_mcp_oauth_provider
):
    """D15. One `asyncio.Lock` per connection was kept for the life of the worker, so a
    long-lived process held one for every connection it had ever refreshed."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="lock-evicted",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )

    await connect_service.refresh_grant(
        project_id=project["project_id"],
        endpoint_id=connection.id,
        server_url=local_mcp_oauth_provider.server_url,
    )

    assert connect_service._refresh_locks == {}


async def test_concurrent_renewals_share_one_lock_and_still_leave_none_behind(
    project, connect_service, local_mcp_oauth_provider
):
    """Eviction must not break the serialization it sits inside: a coroutine waiting to
    acquire is a holder, and handing the next arrival a fresh lock would let two
    exchanges run and spend a handle the provider has already retired."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="lock-shared",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.token_requests = 0

    await asyncio.gather(
        *(
            connect_service.refresh_grant(
                project_id=project["project_id"],
                endpoint_id=connection.id,
                server_url=local_mcp_oauth_provider.server_url,
            )
            for _ in range(5)
        )
    )

    assert local_mcp_oauth_provider.token_requests == 1
    assert connect_service._refresh_locks == {}


async def test_a_failed_renewal_still_releases_its_lock(
    project, connect_service, local_mcp_oauth_provider
):
    """The eviction is in a finally: a connection whose renewal fails must not keep a
    lock forever, which is the case a leak would reach first."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="lock-after-failure",
        name="Acme",
    )
    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    local_mcp_oauth_provider.revoke_renewal_handles()

    with pytest.raises(MCPOAuthRefreshFailedError):
        await connect_service.refresh_grant(
            project_id=project["project_id"],
            endpoint_id=connection.id,
            server_url=local_mcp_oauth_provider.server_url,
        )

    assert connect_service._refresh_locks == {}


# --- a reconnect that lands before the late refusal --------------------------- #


async def test_a_reconnect_in_flight_is_not_condemned_by_the_old_credentials_401(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """D33. The Reconnect button rewrites the grant in place, under the slug the
    connection's identity derives, so the row keeps its id and only the tokens change.
    Comparing the row id could not tell the repaired connection from the failed one, and
    the late 401 marked a working connection as needing another reconnect."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="reconnect-in-flight",
        name="Acme",
    )
    storage = _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    )
    failing = await storage.get_grant()
    assert failing is not None

    # The person reconnects while the doomed call is still out. Same connection, same
    # vault row, new tokens.
    await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project=project,
        endpoint=await _reload(project, connection),
    )
    repaired = await storage.get_grant()
    assert repaired is not None
    assert repaired.access_token != failing.access_token
    assert len(await _grants(project=project)) == 1

    # Now the 401 earned by the old token arrives.
    await relay_service._invalidate_endpoint(  # noqa: SLF001 - the relay's own seam
        scope=_scope(project),
        endpoint=await _reload(project, connection),
        presented_access_token=failing.access_token,
    )

    stored = await _reload(project, connection)
    assert stored.flags.is_valid is True
    assert (
        await _connection_state(relay_service, project, stored)
        == GatewayConnectionState.READY
    )
    # And the repaired connection still relays.
    assert (await _call(relay_service, project, stored)).status_code == 200


async def test_the_credential_that_failed_is_still_invalidated_when_it_is_still_held(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """The comparison must not swallow the case it lives inside."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="still-held",
        name="Acme",
    )
    grant = await _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    ).get_grant()
    assert grant is not None

    await relay_service._invalidate_endpoint(  # noqa: SLF001 - the relay's own seam
        scope=_scope(project),
        endpoint=await _reload(project, connection),
        presented_access_token=grant.access_token,
    )

    stored = await _reload(project, connection)
    assert stored.flags.is_valid is False
    assert (
        await _connection_state(relay_service, project, stored)
        == GatewayConnectionState.NEEDS_AUTH
    )


async def test_a_renewal_that_lands_in_flight_is_not_condemned_either(
    project, relay_service, connect_service, local_mcp_oauth_provider
):
    """A refresh replaces the tokens in the same row the same way a reconnect does, so
    the token a relay presented can go stale without anyone pressing anything."""
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="renewal-in-flight",
        name="Acme",
    )
    storage = _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    )
    presented = await storage.get_grant()
    assert presented is not None

    await _age_the_grant(
        project=project,
        provider=local_mcp_oauth_provider,
        endpoint_id=connection.id,
    )
    await connect_service.refresh_grant(
        project_id=project["project_id"],
        endpoint_id=connection.id,
        server_url=local_mcp_oauth_provider.server_url,
    )

    await relay_service._invalidate_endpoint(  # noqa: SLF001 - the relay's own seam
        scope=_scope(project),
        endpoint=await _reload(project, connection),
        presented_access_token=presented.access_token,
    )

    assert (await _reload(project, connection)).flags.is_valid is True


# --- the same race, driven by the relay rather than by its seam --------------- #


def _relay_over(transport, *, provider, connect_service) -> MCPGatewayService:
    """The relay as the fixture builds it, with the socket replaced.

    The cases above call `_invalidate_endpoint` directly, which proves the guard but not
    that the relay reaches it with the token it actually sent. That is a second claim,
    and it lives in a different function (D82).
    """
    resolver = SecretsResolver(vault_service=VaultService(secrets_dao=SecretsDAO()))
    return MCPGatewayService(
        mcp_endpoints_dao=MCPEndpointsDAO(engine=get_transactions_engine()),
        policy=GatewayPolicyService(resolver=resolver),
        resolver=resolver,
        connections_service=ConnectionsService(
            connections_dao=None,  # type: ignore[arg-type]
            adapter_registry=None,  # type: ignore[arg-type]
        ),
        upstream_registry=MCPUpstreamRegistry(
            adapters={"http": HttpMCPAdapter(transport=transport)}
        ),
        oauth_refresher=connect_service,
    )


async def test_the_relay_itself_does_not_condemn_a_reconnect_that_landed_mid_call(
    project,
    connect_service,
    local_mcp_oauth_provider,
    _allow_every_caller,
    _public_dns_for_the_oauth_provider,
):
    """The whole path, end to end: a call goes out with a credential the provider has
    quietly retired, the person reconnects while it is still out, and the 401 it earns
    comes back to a connection that now holds a different credential.

    Everything before this asserted the guard by calling it. This asserts that the relay
    reaches it at all, and reaches it with the token this call presented rather than with
    whatever the connection holds by the time the answer arrives.
    """
    connection = await _connected(
        project=project,
        connect_service=connect_service,
        provider=local_mcp_oauth_provider,
        slug="reconnect-mid-relay",
        name="Acme",
    )
    storage = _storage(
        project=project, provider=local_mcp_oauth_provider, endpoint_id=connection.id
    )
    failing = await storage.get_grant()
    assert failing is not None

    # The provider retires this one token and says nothing. The stored grant still looks
    # live, which is what makes the relay send it.
    local_mcp_oauth_provider.revoke_access_token(failing.access_token)

    reconnected: List[str] = []

    async def _reconnect_while_the_call_is_out(request):
        """The person presses Reconnect while this request is in flight.

        Run from inside the transport so the ordering is the real one: the relay has
        already resolved and sent the old credential, and the new one is stored before
        the refusal comes back.
        """
        if (
            request.method == "POST"
            and not reconnected
            and request.url.path == "/"  # the MCP surface, not a discovery document
        ):
            reconnected.append("yes")
            await _consent(
                service=connect_service,
                provider=local_mcp_oauth_provider,
                project=project,
                endpoint=await _reload(project, connection),
            )
        return local_mcp_oauth_provider._handle(request)  # noqa: SLF001 - the fixture

    relay = _relay_over(
        httpx.MockTransport(_reconnect_while_the_call_is_out),
        provider=local_mcp_oauth_provider,
        connect_service=connect_service,
    )

    with pytest.raises(MCPAuthRequiredError):
        await _call(relay, project, await _reload(project, connection))

    assert reconnected, "the reconnect never ran, so this proves nothing"
    repaired = await storage.get_grant()
    assert repaired is not None and repaired.access_token != failing.access_token

    # The connection the person just repaired is still usable, and the relay says so.
    stored = await _reload(project, connection)
    assert stored.flags.is_valid is True
    assert (
        await _connection_state(relay, project, stored) == GatewayConnectionState.READY
    )
    assert (await _call(relay, project, stored)).status_code == 200
