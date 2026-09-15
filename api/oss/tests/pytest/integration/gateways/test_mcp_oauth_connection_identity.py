"""Two accounts at one MCP server are two connections, against real Postgres.

A server URL is an address. Several connections in one project can name the same one,
because a person can hold two accounts at that server, and each connection's grant is
its own. These cases run the whole consent path — begin, callback, token exchange, vault
write — twice at one URL and check that the second consent did not land on the first
one's row.

The grant used to be stored under a slug derived from the server URL, so it did. The
second consent updated the first connection's row, the first connection went on relaying
as the second account, and nothing reported it. Everything below fails against that key.

Real Postgres rather than an in-memory DAO, because the record these cases are about is
a `secrets` row addressed by a unique index, and an in-memory DAO has neither.
"""

from __future__ import annotations

import time
from typing import List
from uuid import uuid4

import pytest
from mcp.shared.auth import OAuthToken

from oss.src.core.gateways.mcps.dtos import (
    MCPAuthScheme,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage, grant_slug
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshFailedError
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def _create_connection(*, project, slug: str, name: str, base_url: str):
    dao = MCPEndpointsDAO(engine=get_transactions_engine())
    return await dao.create_endpoint(
        project_id=project["project_id"],
        user_id=project["user_id"],
        endpoint=MCPEndpointCreate(
            slug=slug,
            name=name,
            auth_mode=MCPAuthScheme.OAUTH,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=base_url)),
        ),
    )


async def _consent(*, service, provider, project_id, user_id, endpoint_id):
    """One complete consent: begin, the browser leg, callback, grant written."""
    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=provider.server_url,
        scopes=["tools:call"],
    )
    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    return await service.complete(
        attempt=attempt,
        code=provider.callback_params(state=start.state)["code"],
    )


async def _grants(*, project_id) -> List:
    vault = VaultService(secrets_dao=SecretsDAO())
    return [
        secret
        for secret in await vault.list_secrets(project_id=project_id)
        if secret.kind == SecretKind.OAUTH_GRANT
    ]


def _storage(*, project_id, server_url, endpoint_id) -> SecretsTokenStorage:
    return SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project_id,
        server_url=server_url,
        endpoint_id=endpoint_id,
    )


async def test_two_accounts_at_one_url_each_keep_their_own_grant(
    project, connect_service, local_mcp_oauth_provider
):
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    account_a = await _create_connection(
        project=project, slug="acme-account-a", name="Acme, work", base_url=url
    )
    account_b = await _create_connection(
        project=project, slug="acme-account-b", name="Acme, personal", base_url=url
    )
    assert account_a.data.route.base_url == account_b.data.route.base_url

    completed_a = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=account_a.id,
    )
    completed_b = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=account_b.id,
    )

    # Two rows, two handles. Under the URL-derived key both consents returned one id.
    assert completed_a.secret_id != completed_b.secret_id
    grants = await _grants(project_id=project_id)
    assert len(grants) == 2
    assert {grant.id for grant in grants} == {
        completed_a.secret_id,
        completed_b.secret_id,
    }

    # Each row is addressed by, and records, the connection it belongs to.
    by_slug = {grant.slug: grant for grant in grants}
    assert set(by_slug) == {grant_slug(account_a.id), grant_slug(account_b.id)}
    assert by_slug[grant_slug(account_a.id)].data.grant.endpoint_id == account_a.id
    assert by_slug[grant_slug(account_b.id)].data.grant.endpoint_id == account_b.id


async def test_renewing_one_account_leaves_the_other_at_the_same_url_untouched(
    project, connect_service, local_mcp_oauth_provider
):
    """A rotating authorization server retires a renewal handle the moment it is spent,
    so renewing on the wrong row does not merely rewrite it: it burns a handle the
    rightful connection still needs."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    account_a = await _create_connection(
        project=project, slug="renew-a", name="Acme, work", base_url=url
    )
    account_b = await _create_connection(
        project=project, slug="renew-b", name="Acme, personal", base_url=url
    )
    for endpoint_id in (account_a.id, account_b.id):
        await _consent(
            service=connect_service,
            provider=local_mcp_oauth_provider,
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )

    storage_a = _storage(
        project_id=project_id, server_url=url, endpoint_id=account_a.id
    )
    storage_b = _storage(
        project_id=project_id, server_url=url, endpoint_id=account_b.id
    )
    before_a = await storage_a.get_grant()
    assert before_a is not None

    # Age B's grant past its expiry, the way a long-lived connection reaches a renewal.
    # Written through a storage carrying the same issuer pin the consent wrote, because
    # a renewal refuses a grant that does not record who issued it.
    aged = await storage_b.get_grant()
    assert aged is not None
    aging_writer = SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project_id,
        server_url=url,
        endpoint_id=account_b.id,
        authorization_server=aged.issuer,
    )
    await aging_writer.write_tokens(
        OAuthToken(
            access_token=aged.access_token,
            token_type="Bearer",
            expires_in=-3600,
            refresh_token=aged.refresh_token,
            scope=" ".join(aged.scopes) if aged.scopes else None,
        )
    )

    await connect_service.refresh_grant(
        project_id=project_id, endpoint_id=account_b.id, server_url=url
    )

    after_a = await storage_a.get_grant()
    assert after_a is not None
    assert after_a.access_token == before_a.access_token
    assert after_a.refresh_token == before_a.refresh_token
    assert after_a.expires_at == before_a.expires_at

    after_b = await storage_b.get_grant()
    assert after_b is not None
    assert after_b.expires_at is not None
    assert after_b.expires_at > int(time.time())

    # The end state that matters: A's renewal handle was never spent, so A can still
    # renew. The provider rotates, so a handle B's refresh had burned would be refused.
    aging_a = SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project_id,
        server_url=url,
        endpoint_id=account_a.id,
        authorization_server=before_a.issuer,
    )
    await aging_a.write_tokens(
        OAuthToken(
            access_token=before_a.access_token,
            token_type="Bearer",
            expires_in=-3600,
            refresh_token=before_a.refresh_token,
            scope=" ".join(before_a.scopes) if before_a.scopes else None,
        )
    )
    await connect_service.refresh_grant(
        project_id=project_id, endpoint_id=account_a.id, server_url=url
    )
    renewed_a = await storage_a.get_grant()
    assert renewed_a is not None
    assert renewed_a.expires_at is not None
    assert renewed_a.expires_at > int(time.time())


async def test_an_unconnected_account_is_not_handed_a_siblings_grant(
    project, connect_service, local_mcp_oauth_provider
):
    """Two connections at one URL, only one connected. The other must be told to
    connect rather than quietly relaying as the account that did."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    connected = await _create_connection(
        project=project, slug="sibling-connected", name="Acme, work", base_url=url
    )
    unconnected = await _create_connection(
        project=project, slug="sibling-unconnected", name="Acme, personal", base_url=url
    )
    await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connected.id,
    )

    storage = _storage(
        project_id=project_id, server_url=url, endpoint_id=unconnected.id
    )
    assert await storage.get_grant() is None
    assert await storage.get_tokens() is None

    with pytest.raises(MCPOAuthRefreshFailedError):
        await connect_service.refresh_grant(
            project_id=project_id, endpoint_id=unconnected.id, server_url=url
        )


async def test_renaming_a_connection_keeps_its_identity_and_its_grant(
    project, connect_service, local_mcp_oauth_provider
):
    """The display name is a label. Editing it must not move the connection's identity,
    and must not cost it the account it is connected to."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url
    dao = MCPEndpointsDAO(engine=get_transactions_engine())

    connection = await _create_connection(
        project=project, slug="rename-me", name="Acme", base_url=url
    )
    completed = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )
    connected = await dao.edit_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointEdit(
            id=connection.id,
            name=connection.name,
            auth_mode=MCPAuthScheme.OAUTH,
            secret_id=completed.secret_id,
            data=connection.data,
        ),
    )
    assert connected is not None and connected.secret_id == completed.secret_id

    renamed = await dao.edit_endpoint(
        project_id=project_id,
        user_id=user_id,
        endpoint=MCPEndpointEdit(
            id=connection.id,
            name="Acme, personal",
            auth_mode=MCPAuthScheme.OAUTH,
            secret_id=connected.secret_id,
            data=connected.data,
        ),
    )

    assert renamed is not None
    assert renamed.name == "Acme, personal"
    assert renamed.id == connection.id
    assert renamed.slug == connection.slug
    assert renamed.secret_id == completed.secret_id

    # And the grant is still reachable under the identity the rename did not touch.
    storage = _storage(project_id=project_id, server_url=url, endpoint_id=renamed.id)
    grant = await storage.get_grant()
    assert grant is not None and grant.endpoint_id == renamed.id
    assert len(await _grants(project_id=project_id)) == 1


async def test_a_connection_moved_to_another_url_keeps_its_grant_row(
    project, connect_service, local_mcp_oauth_provider
):
    """The URL is routing, so changing it does not change which row the connection's
    credentials live in. Whether the old account's tokens still work at the new address
    is the upstream's business; losing track of the row is not."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    connection = await _create_connection(
        project=project, slug="moved", name="Acme", base_url=url
    )
    completed = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )

    moved = _storage(
        project_id=project_id,
        server_url="https://mcp.elsewhere.local/",
        endpoint_id=connection.id,
    )
    grant = await moved.get_grant()

    assert grant is not None
    assert grant.endpoint_id == connection.id
    assert len(await _grants(project_id=project_id)) == 1
    assert (await _grants(project_id=project_id))[0].id == completed.secret_id


async def test_two_projects_at_one_url_never_see_each_others_grants(
    project, connect_service, local_mcp_oauth_provider
):
    """Tenancy, restated against the new key: the slug is unique within a project, and
    the lookup is scoped to one."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    connection = await _create_connection(
        project=project, slug="tenancy", name="Acme", base_url=url
    )
    await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )

    # Same connection id, another project. Nothing is reachable.
    elsewhere = _storage(project_id=uuid4(), server_url=url, endpoint_id=connection.id)
    assert await elsewhere.get_grant() is None


async def test_disconnecting_one_account_leaves_the_other_at_the_same_url_working(
    project, connect_service, local_mcp_oauth_provider
):
    """The operation the settings surface needs: drop one account's authorization and
    leave every other connection to that server untouched."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    account_a = await _create_connection(
        project=project, slug="disconnect-a", name="Acme, work", base_url=url
    )
    account_b = await _create_connection(
        project=project, slug="disconnect-b", name="Acme, personal", base_url=url
    )
    for endpoint_id in (account_a.id, account_b.id):
        await _consent(
            service=connect_service,
            provider=local_mcp_oauth_provider,
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )
    assert len(await _grants(project_id=project_id)) == 2

    dropped = await connect_service.disconnect(
        project_id=project_id, endpoint_id=account_a.id, server_url=url
    )

    assert dropped is True
    remaining = await _grants(project_id=project_id)
    assert len(remaining) == 1
    assert remaining[0].slug == grant_slug(account_b.id)

    storage_b = _storage(
        project_id=project_id, server_url=url, endpoint_id=account_b.id
    )
    grant_b = await storage_b.get_grant()
    assert grant_b is not None and grant_b.access_token

    storage_a = _storage(
        project_id=project_id, server_url=url, endpoint_id=account_a.id
    )
    assert await storage_a.get_grant() is None

    # And B can still renew, so A's disconnect did not spend B's handle.
    aging_b = SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project_id,
        server_url=url,
        endpoint_id=account_b.id,
        authorization_server=grant_b.issuer,
    )
    await aging_b.write_tokens(
        OAuthToken(
            access_token=grant_b.access_token,
            token_type="Bearer",
            expires_in=-3600,
            refresh_token=grant_b.refresh_token,
            scope=" ".join(grant_b.scopes) if grant_b.scopes else None,
        )
    )
    await connect_service.refresh_grant(
        project_id=project_id, endpoint_id=account_b.id, server_url=url
    )
    renewed_b = await storage_b.get_grant()
    assert renewed_b is not None
    assert renewed_b.expires_at is not None
    assert renewed_b.expires_at > int(time.time())


async def test_disconnecting_something_already_disconnected_changes_nothing(
    project, connect_service, local_mcp_oauth_provider
):
    """A repeated click or a retried request is not an error."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    connection = await _create_connection(
        project=project, slug="twice", name="Acme", base_url=url
    )
    await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )

    assert (
        await connect_service.disconnect(
            project_id=project_id, endpoint_id=connection.id, server_url=url
        )
        is True
    )
    assert (
        await connect_service.disconnect(
            project_id=project_id, endpoint_id=connection.id, server_url=url
        )
        is False
    )
    assert await _grants(project_id=project_id) == []


async def test_a_disconnected_connection_can_consent_again(
    project, connect_service, local_mcp_oauth_provider
):
    """Disconnect is not delete: the connection keeps its identity, so reconnecting
    lands on the same row every configured agent already names."""
    project_id, user_id = project["project_id"], project["user_id"]
    url = local_mcp_oauth_provider.server_url

    connection = await _create_connection(
        project=project, slug="reconnect", name="Acme", base_url=url
    )
    first = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )
    await connect_service.disconnect(
        project_id=project_id, endpoint_id=connection.id, server_url=url
    )

    second = await _consent(
        service=connect_service,
        provider=local_mcp_oauth_provider,
        project_id=project_id,
        user_id=user_id,
        endpoint_id=connection.id,
    )

    # A new row, because the old one was deleted, but under the same slug: the
    # connection's identity outlives its credentials.
    assert second.secret_id != first.secret_id
    grants = await _grants(project_id=project_id)
    assert len(grants) == 1
    assert grants[0].slug == grant_slug(connection.id)
    assert grants[0].data.grant.endpoint_id == connection.id
