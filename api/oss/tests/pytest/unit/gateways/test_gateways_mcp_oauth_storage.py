"""Unit tests for `SecretsTokenStorage`.

A real `VaultService` over an in-memory fake `SecretsDAOInterface` — no Postgres, no
encryption key, no network — matching `unit/secrets/test_services.py`'s own fake-DAO
pattern.
"""

from __future__ import annotations

from typing import List, Optional, Tuple
from uuid import UUID, uuid4

import pytest
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService


class _FakeSecretsDAO:
    def __init__(self) -> None:
        self.records: List[Tuple[UUID, SecretResponseDTO]] = []
        self.create_calls = 0
        self.update_calls = 0

    def _scoped(self, project_id) -> List[SecretResponseDTO]:
        return [r for p, r in self.records if p == project_id]

    async def create(self, *, project_id=None, organization_id=None, create_secret_dto):
        self.create_calls += 1
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )
        self.records.append((project_id, record))
        return record

    async def get_by_id(self, secret_id, project_id=None, organization_id=None):
        return next((r for r in self._scoped(project_id) if r.id == secret_id), None)

    async def get_by_slug(self, secret_slug, project_id=None, organization_id=None):
        return next(
            (r for r in self._scoped(project_id) if r.slug == secret_slug), None
        )

    async def list(self, project_id=None, organization_id=None):
        return self._scoped(project_id)

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id=None,
        organization_id=None,
        user_id=None,
        resolve_update=None,
    ):
        self.update_calls += 1
        scoped = self._scoped(project_id)
        stored = next((r for r in scoped if r.id == secret_id), None)
        if stored is None:
            return None
        record = SecretResponseDTO(
            id=stored.id,
            slug=stored.slug,
            kind=stored.kind,
            data=update_secret_dto.secret.data.model_dump(exclude_none=True),
            header=update_secret_dto.header or stored.header,
        )
        idx = self.records.index((project_id, stored))
        self.records[idx] = (project_id, record)
        return record

    async def delete(self, secret_id, project_id=None, organization_id=None):
        self.records = [
            (p, r)
            for p, r in self.records
            if not (p == project_id and r.id == secret_id)
        ]


def _storage(
    *,
    dao: Optional[_FakeSecretsDAO] = None,
    project_id=None,
    server_url="https://mcp.acme.io/",
    authorization_server=None,
):
    dao = dao or _FakeSecretsDAO()
    vault = VaultService(secrets_dao=dao)
    storage = SecretsTokenStorage(
        vault_service=vault,
        project_id=project_id or uuid4(),
        server_url=server_url,
        authorization_server=authorization_server,
    )
    return storage, dao


# --- tokens ------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_get_tokens_returns_none_when_nothing_stored():
    storage, _dao = _storage()

    assert await storage.get_tokens() is None


@pytest.mark.asyncio
async def test_set_then_get_tokens_round_trips():
    storage, _dao = _storage()

    await storage.set_tokens(
        OAuthToken(
            access_token="tok-1",
            refresh_token="ref-1",
            expires_in=3600,
            scope="read write",
        )
    )
    tokens = await storage.get_tokens()

    assert tokens is not None
    assert tokens.access_token == "tok-1"
    assert tokens.refresh_token == "ref-1"
    assert tokens.token_type == "Bearer"
    assert tokens.scope == "read write"
    assert tokens.expires_in is not None and tokens.expires_in > 0


@pytest.mark.asyncio
async def test_second_set_tokens_updates_in_place_not_a_second_row():
    storage, dao = _storage()

    await storage.set_tokens(OAuthToken(access_token="tok-1"))
    await storage.set_tokens(OAuthToken(access_token="tok-2"))

    assert dao.create_calls == 1
    assert dao.update_calls == 1
    tokens = await storage.get_tokens()
    assert tokens is not None
    assert tokens.access_token == "tok-2"


@pytest.mark.asyncio
async def test_two_server_urls_under_one_project_do_not_collide():
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    storage_a, _ = _storage(
        dao=dao, project_id=project_id, server_url="https://a.example/mcp"
    )
    storage_b, _ = _storage(
        dao=dao, project_id=project_id, server_url="https://b.example/mcp"
    )

    await storage_a.set_tokens(OAuthToken(access_token="tok-a"))
    await storage_b.set_tokens(OAuthToken(access_token="tok-b"))

    tokens_a = await storage_a.get_tokens()
    tokens_b = await storage_b.get_tokens()
    assert tokens_a is not None and tokens_a.access_token == "tok-a"
    assert tokens_b is not None and tokens_b.access_token == "tok-b"


@pytest.mark.asyncio
async def test_two_projects_on_the_same_server_url_do_not_collide():
    dao = _FakeSecretsDAO()
    storage_p1, _ = _storage(
        dao=dao, project_id=uuid4(), server_url="https://mcp.acme.io/"
    )
    storage_p2, _ = _storage(
        dao=dao, project_id=uuid4(), server_url="https://mcp.acme.io/"
    )

    await storage_p1.set_tokens(OAuthToken(access_token="tok-p1"))

    assert await storage_p2.get_tokens() is None
    tokens_p1 = await storage_p1.get_tokens()
    assert tokens_p1 is not None and tokens_p1.access_token == "tok-p1"


@pytest.mark.asyncio
async def test_write_tokens_returns_the_written_secret_id():
    storage, _dao = _storage()

    written = await storage.write_tokens(OAuthToken(access_token="tok-1"))

    assert written.id is not None
    grant = await storage.get_tokens()
    assert grant is not None and grant.access_token == "tok-1"


# --- client info --------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_get_client_info_returns_none_when_nothing_stored():
    storage, _dao = _storage()

    assert await storage.get_client_info() is None


@pytest.mark.asyncio
async def test_set_then_get_client_info_round_trips():
    storage, _dao = _storage(authorization_server="https://auth.acme.io/")

    info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-123",
        client_secret="shh",
        scope="read write",
    )
    await storage.set_client_info(info)
    fetched = await storage.get_client_info()

    assert fetched is not None
    assert fetched.client_id == "client-123"
    assert fetched.client_secret == "shh"


@pytest.mark.asyncio
async def test_second_set_client_info_updates_in_place():
    storage, dao = _storage(authorization_server="https://auth.acme.io/")

    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
            client_id="client-1",
        )
    )
    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
            client_id="client-2",
        )
    )

    assert dao.create_calls == 1
    assert dao.update_calls == 1
    fetched = await storage.get_client_info()
    assert fetched is not None and fetched.client_id == "client-2"


@pytest.mark.asyncio
async def test_client_info_falls_back_to_server_url_before_issuer_is_known():
    storage, _dao = _storage(authorization_server=None)

    info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-preregistration",
    )
    await storage.set_client_info(info)
    fetched = await storage.get_client_info()

    assert fetched is not None and fetched.client_id == "client-preregistration"
