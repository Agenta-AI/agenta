"""OR61: two OAuth callbacks completing at once must not hit a unique violation.

A grant is stored under a slug derived from the connection it belongs to, and a client
registration under one derived from the authorization server. Both are deterministic, so
two writers racing on the same record compute the same slug, both read nothing, and both
create. Postgres arbitrates with `uq_secrets_project_id_slug`; the loser converts its
refusal into the update it would have made. These cases run that against a real database,
because an in-memory DAO has no unique index and so cannot fail the way production does.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken


pytestmark = [pytest.mark.integration]

_SERVER_URL = "https://mcp.race.local/"
# One connection. The race these cases reproduce is two callbacks for the same
# connection, which is what a person double-clicking Connect produces.
_ENDPOINT_ID = uuid4()
_ISSUER = "https://auth.race.local/"
_REDIRECT_URI = "https://api.race.local/gateways/mcps/connect/callback"


@pytest.fixture
async def project_with_readable_secrets(seeded_project):
    """`seeded_project` plants one `secrets` row whose `data` is NULL, as a bare FK
    target for the endpoint DAO cases. Reading the vault through `VaultService` decrypts
    every row in the project, so that row has to go before these cases list anything."""
    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE id = :id"),
            {"id": seeded_project["secret_id"]},
        )
        await session.commit()
    return seeded_project["project_id"]


def _storage(*, project_id, endpoint_id=None) -> SecretsTokenStorage:
    return SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id or _ENDPOINT_ID,
        authorization_server=_ISSUER,
    )


def _client_info(*, client_id: str) -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        redirect_uris=[_REDIRECT_URI],
        client_id=client_id,
        client_secret=f"registration-material-for-{client_id}",
        scope="read",
    )


async def _stored(*, project_id, kind: SecretKind):
    vault = VaultService(secrets_dao=SecretsDAO())
    return [
        secret
        for secret in await vault.list_secrets(project_id=project_id)
        if secret.kind == kind
    ]


@pytest.mark.asyncio
async def test_two_concurrent_registration_writes_for_one_slug_both_resolve(
    project_with_readable_secrets,
):
    project_id = project_with_readable_secrets

    await asyncio.gather(
        _storage(project_id=project_id).set_client_info(
            _client_info(client_id="client-one")
        ),
        _storage(project_id=project_id).set_client_info(
            _client_info(client_id="client-two")
        ),
    )

    rows = await _stored(project_id=project_id, kind=SecretKind.OAUTH_PROVIDER)
    assert len(rows) == 1
    # One of the two won; which one is the database's business, not this test's.
    assert rows[0].data.provider.client_id in {"client-one", "client-two"}


@pytest.mark.asyncio
async def test_two_concurrent_grant_writes_for_one_connection_both_resolve(
    project_with_readable_secrets,
):
    project_id = project_with_readable_secrets

    written = await asyncio.gather(
        _storage(project_id=project_id).write_tokens(
            OAuthToken(access_token="grant-one", token_type="Bearer", expires_in=3600)
        ),
        _storage(project_id=project_id).write_tokens(
            OAuthToken(access_token="grant-two", token_type="Bearer", expires_in=3600)
        ),
    )

    rows = await _stored(project_id=project_id, kind=SecretKind.OAUTH_GRANT)
    assert len(rows) == 1
    # Both callers were handed the same row, so the endpoint handle each writes is the
    # one the other's tokens live under.
    assert {record.id for record in written} == {rows[0].id}
