"""EE organization-provider edits: what a PATCH sends is what the next read returns.

A vault call inside `update_provider` closes the shared session and detaches the provider it
loaded, so a write to that object never reaches the database. The fake DAO below keeps that
property: it hands out copies, and only what reaches `update` lands on the stored row.
"""

from copy import copy
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.src.core.organizations import service as organization_service_module
from ee.src.core.organizations.service import OrganizationProvidersService
from ee.src.core.organizations.types import OrganizationProviderUpdate
from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO
from oss.src.core.secrets.dtos import SecretResponseDTO


ORGANIZATION_ID = uuid4()
PROVIDER_ID = uuid4()
SECRET_ID = uuid4()


class _Session:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def commit(self):
        return None

    async def refresh(self, row):
        return None


class _Engine:
    def session(self):
        return _Session()


class _Vault:
    def __init__(self, secret):
        self._secret = secret
        self.updates = []

    async def get_secret_by_id(
        self, *, secret_id, organization_id=None, project_id=None
    ):
        return self._secret

    async def update_secret(self, *, secret_id, organization_id, update_secret_dto):
        self.updates.append(update_secret_dto)
        return self._secret


def _sso_secret() -> SecretResponseDTO:
    return SecretResponseDTO(
        id=SECRET_ID,
        slug="sso",
        kind="sso_provider",
        data={
            "provider": {
                "client_id": "client-1",
                "client_secret": "super-secret-value-123",
                "issuer_url": "https://issuer.example.com",
                "scopes": ["openid"],
            }
        },
        header={"name": "okta"},
        write_only=True,
    )


class _DetachingProviderDAO:
    def __init__(self, row):
        self.row = row
        self.taken_slugs = {}

    def __call__(self, session):
        return self

    async def get_by_id(self, *, provider_id, organization_id):
        return copy(self.row)

    async def get_by_slug(self, *, slug, organization_id):
        if slug == self.row.slug:
            return copy(self.row)
        return self.taken_slugs.get(slug)

    async def update(self, *, updated_by_id=None, provider_id, **fields):
        for key, value in fields.items():
            if value is not None:
                setattr(self.row, key, value)
        return self.row


def _provider_row() -> SimpleNamespace:
    return SimpleNamespace(
        id=PROVIDER_ID,
        organization_id=ORGANIZATION_ID,
        slug="okta",
        name="Okta",
        description="Staff sign-in",
        secret_id=SECRET_ID,
        flags={"is_valid": True, "is_active": True},
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=None,
    )


@pytest.fixture
def provider_edit(monkeypatch):
    row = _provider_row()
    dao = _DetachingProviderDAO(row)
    vault = _Vault(_sso_secret())
    monkeypatch.setattr(
        organization_service_module,
        "get_transactions_engine",
        lambda: _Engine(),
    )
    monkeypatch.setattr(organization_service_module, "OrganizationProvidersDAO", dao)
    monkeypatch.setattr(
        OrganizationProvidersService,
        "_vault_service",
        staticmethod(lambda: vault),
    )

    async def edit(**fields):
        return await OrganizationProvidersService().update_provider(
            str(ORGANIZATION_ID),
            str(PROVIDER_ID),
            OrganizationProviderUpdate(**fields),
            user_id=str(uuid4()),
        )

    return SimpleNamespace(row=row, dao=dao, vault=vault, edit=edit)


@pytest.mark.asyncio
async def test_edit_saves_the_name_slug_and_description(provider_edit):
    response = await provider_edit.edit(
        slug="okta-staff", name="Okta staff", description="Renamed"
    )

    assert provider_edit.row.slug == "okta-staff"
    assert provider_edit.row.name == "Okta staff"
    assert provider_edit.row.description == "Renamed"
    assert response.slug == "okta-staff"
    assert response.name == "Okta staff"
    assert response.description == "Renamed"
    # Only a settings change invalidates the provider: a rename leaves it signing people in.
    assert provider_edit.row.flags == {"is_valid": True, "is_active": True}
    assert provider_edit.vault.updates == []


@pytest.mark.asyncio
async def test_edit_keeps_the_fields_it_does_not_send(provider_edit):
    await provider_edit.edit(name="Okta staff")

    assert provider_edit.row.name == "Okta staff"
    assert provider_edit.row.slug == "okta"
    assert provider_edit.row.description == "Staff sign-in"


@pytest.mark.asyncio
async def test_edit_with_an_empty_description_clears_it(provider_edit):
    await provider_edit.edit(description="")

    assert provider_edit.row.description == ""


@pytest.mark.asyncio
async def test_edit_accepts_the_provider_own_unchanged_slug(provider_edit):
    await provider_edit.edit(slug="okta", name="Okta staff")

    assert provider_edit.row.name == "Okta staff"


@pytest.mark.asyncio
async def test_edit_refuses_a_slug_another_provider_holds(provider_edit):
    provider_edit.dao.taken_slugs["azure"] = SimpleNamespace(id=uuid4())

    with pytest.raises(HTTPException) as refusal:
        await provider_edit.edit(slug="azure", name="Azure")

    assert refusal.value.status_code == 400
    assert provider_edit.row.slug == "okta"
    assert provider_edit.row.name == "Okta"


@pytest.mark.asyncio
async def test_settings_edit_names_the_secret_after_the_new_slug(provider_edit):
    await provider_edit.edit(
        slug="okta-staff",
        description="Renamed",
        settings={"issuer_url": "https://new-issuer.example.com"},
    )

    header = provider_edit.vault.updates[0].header
    assert header.name == "okta-staff"
    assert header.description == "Renamed"
    assert provider_edit.row.slug == "okta-staff"
    assert provider_edit.row.flags == {"is_valid": False, "is_active": False}


class _RowSession:
    def __init__(self, row):
        self.row = row

    async def get(self, model, identity):
        return self.row

    async def flush(self):
        return None

    async def refresh(self, row):
        return None


@pytest.mark.asyncio
async def test_dao_update_writes_only_the_fields_it_receives():
    row = _provider_row()
    dao = OrganizationProvidersDAO(session=_RowSession(row), engine=object())

    await dao.update(provider_id=str(PROVIDER_ID), name="Okta staff", description="")

    assert row.name == "Okta staff"
    assert row.description == ""
    assert row.slug == "okta"
    assert row.flags == {"is_valid": True, "is_active": True}
    assert row.updated_at is not None

    await dao.update(provider_id=str(PROVIDER_ID), slug="okta-staff")

    assert row.slug == "okta-staff"
    assert row.name == "Okta staff"
