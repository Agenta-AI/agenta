"""A write-only OAuth secret returns no credential, whichever field holds it.

Two ways a credential escaped the vault's public projection, both covered here: a field the
per-kind map never named (a grant's refresh token, the longer-lived of its two tokens), and
a second copy of a client secret nested inside the free-form `extra` map a dynamic client
registration was copied into.

All credential values below are synthetic.
"""

import json
from uuid import uuid4

import pytest
from mcp.shared.auth import OAuthClientInformationFull

from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretResponseDTO
from oss.src.core.secrets.redaction import redact_secret_response
from oss.src.core.secrets.services import VaultService


PROJECT_ID = uuid4()
ISSUER_URL = "https://auth.example.test/"
SERVER_URL = "https://mcp.example.test/sse"

ACCESS_TOKEN = "synthetic-access-token-0000000000"
REFRESH_TOKEN = "synthetic-refresh-token-000000000"
CLIENT_SECRET = "synthetic-client-secret-000000000"


class _FakeSecretsDAO:
    """In-memory DAO, same shape as `unit/secrets/test_write_only.py`'s."""

    def __init__(self):
        self.records: dict = {}

    async def create(self, project_id, organization_id, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[record.id] = record
        return record

    async def list(self, project_id, organization_id):
        return list(self.records.values())

    async def get_by_id(self, secret_id, project_id, organization_id):
        return self.records.get(secret_id)

    async def get_by_slug(self, secret_slug, project_id=None, organization_id=None):
        return next(
            (r for r in self.records.values() if r.slug == secret_slug),
            None,
        )

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        stored = self.records.get(secret_id)
        if stored is None:
            return None
        if resolve_update is not None:
            update_secret_dto = resolve_update(stored, update_secret_dto)
        updated = stored.model_copy(
            update={"header": update_secret_dto.header or stored.header}
        )
        if update_secret_dto.secret is not None:
            updated.kind = update_secret_dto.secret.kind
            updated.data = update_secret_dto.secret.data
        self.records[secret_id] = updated
        return updated

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        self.records.pop(secret_id, None)


@pytest.fixture(name="dao")
def _dao():
    return _FakeSecretsDAO()


@pytest.fixture(name="service")
def _service(dao):
    return VaultService(dao)


def _rendered(secret) -> str:
    """Everything a caller would receive, as one string to search for a credential."""
    return json.dumps(secret.model_dump(mode="json"), default=str)


# --- a grant: every token, not just the one the map remembered ------------------------ #


@pytest.mark.asyncio
async def test_a_write_only_grant_returns_neither_of_its_tokens(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            slug="oauth-grant-example",
            header={"name": "OAuth grant"},
            secret={
                "kind": "oauth_grant",
                "data": {
                    "grant": {
                        "server": SERVER_URL,
                        "access_token": ACCESS_TOKEN,
                        "refresh_token": REFRESH_TOKEN,
                        "scopes": ["read"],
                    }
                },
            },
            write_only=True,
        ),
    )

    public = redact_secret_response(created)

    assert public.data.grant.access_token is None
    assert public.data.grant.refresh_token is None
    assert ACCESS_TOKEN not in _rendered(public)
    assert REFRESH_TOKEN not in _rendered(public)
    # Still reported as configured, so the UI can say a grant exists.
    assert public.value_status.configured is True


# --- a client registration: no second copy of the secret ------------------------------ #


def _client_info() -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        redirect_uris=["https://api.example.test/gateways/mcps/connect/callback"],
        client_id="client-123",
        client_secret=CLIENT_SECRET,
        scope="read write",
    )


@pytest.mark.asyncio
async def test_a_registered_oauth_client_stores_its_secret_once(service, dao):
    storage = SecretsTokenStorage(
        vault_service=service,
        project_id=PROJECT_ID,
        server_url=SERVER_URL,
        authorization_server=ISSUER_URL,
    )

    await storage.set_client_info(_client_info())
    stored = list(dao.records.values())[0]

    # The registration metadata is kept; the credential inside it is not.
    assert stored.data.provider.extra["client_info"]["client_id"] == "client-123"
    assert CLIENT_SECRET not in json.dumps(stored.data.provider.extra)
    assert stored.data.provider.client_secret == CLIENT_SECRET
    # The OAuth client still gets a complete registration back.
    fetched = await storage.get_client_info()
    assert fetched is not None
    assert fetched.client_secret == CLIENT_SECRET
    assert fetched.redirect_uris == _client_info().redirect_uris


@pytest.mark.asyncio
async def test_a_write_only_provider_returns_no_client_secret_anywhere(service, dao):
    storage = SecretsTokenStorage(
        vault_service=service,
        project_id=PROJECT_ID,
        server_url=SERVER_URL,
        authorization_server=ISSUER_URL,
    )
    await storage.set_client_info(_client_info())
    stored = list(dao.records.values())[0]

    public = redact_secret_response(stored.model_copy(update={"write_only": True}))

    assert public.data.provider.client_secret is None
    assert CLIENT_SECRET not in _rendered(public)


@pytest.mark.asyncio
async def test_a_row_written_before_the_fix_is_still_redacted(service):
    """A registration stored with the secret nested under `extra` predates the fix.

    Those rows stay in the vault, so the projection scrubs credential-named keys inside the
    free-form map as well as the settings field beside it.
    """
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            slug="oauth-provider-legacy",
            header={"name": "OAuth client"},
            secret={
                "kind": "oauth_provider",
                "data": {
                    "provider": {
                        "client_id": "client-123",
                        "client_secret": CLIENT_SECRET,
                        "issuer_url": ISSUER_URL,
                        "scopes": ["read"],
                        "extra": {
                            "client_info": {
                                "client_id": "client-123",
                                "client_secret": CLIENT_SECRET,
                            }
                        },
                    }
                },
            },
            write_only=True,
        ),
    )

    public = redact_secret_response(created)

    assert CLIENT_SECRET not in _rendered(public)
    # The non-credential registration metadata survives the scrub.
    assert public.data.provider.extra["client_info"]["client_id"] == "client-123"
