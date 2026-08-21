"""EE organization-provider settings: redacted outward, plaintext where it authenticates.

Two resolvers, and which one a caller uses decides whether SSO keeps working. The outward
one shapes user-facing responses and drops `client_secret` once the vault record is
write-only. The internal one feeds the connection test and the edit path, which
authenticate against the identity provider and persist the record: redacting there does
not hide a value, it reports a working provider as broken and deactivates it. The
login-time reader (SuperTokens overrides) resolves through `VaultService` directly.
"""

from uuid import uuid4

import pytest

from ee.src.core.organizations.service import OrganizationProvidersService
from oss.src.core.secrets.dtos import SecretResponseDTO


ORGANIZATION_ID = uuid4()
SECRET_ID = uuid4()


class _StubVaultService:
    def __init__(self, secret):
        self._secret = secret

    async def get_secret_by_id(
        self, *, secret_id, organization_id=None, project_id=None
    ):
        return self._secret


def _sso_secret(write_only: bool) -> SecretResponseDTO:
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
        write_only=write_only,
    )


def _with_secret(monkeypatch, secret) -> OrganizationProvidersService:
    monkeypatch.setattr(
        OrganizationProvidersService,
        "_vault_service",
        staticmethod(lambda: _StubVaultService(secret)),
    )
    return OrganizationProvidersService()


@pytest.mark.asyncio
async def test_write_only_sso_secret_drops_client_secret_from_responses(monkeypatch):
    service = _with_secret(monkeypatch, _sso_secret(write_only=True))

    settings = await service._get_outward_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )

    assert settings.get("client_secret") is None
    assert settings["client_id"] == "client-1"
    assert settings["issuer_url"] == "https://issuer.example.com"


@pytest.mark.asyncio
async def test_readable_sso_secret_keeps_todays_responses(monkeypatch):
    service = _with_secret(monkeypatch, _sso_secret(write_only=False))

    settings = await service._get_outward_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )

    assert settings["client_secret"] == "super-secret-value-123"


@pytest.mark.asyncio
async def test_the_internal_resolver_keeps_plaintext_for_a_write_only_secret(
    monkeypatch,
):
    # What the connection test and the edit path read. Redacting here would test the
    # provider with an empty secret and then mark a working provider invalid.
    service = _with_secret(monkeypatch, _sso_secret(write_only=True))

    settings = await service._get_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )

    assert settings["client_secret"] == "super-secret-value-123"


@pytest.mark.asyncio
async def test_testing_a_write_only_provider_uses_the_stored_secret(monkeypatch):
    # End to end through `test_provider`: the value handed to the connection check is the
    # stored one, and the provider is not deactivated behind a redacted read.
    service = _with_secret(monkeypatch, _sso_secret(write_only=True))
    seen: dict = {}

    async def _record(*, issuer_url, client_id, client_secret):
        seen.update(
            issuer_url=issuer_url, client_id=client_id, client_secret=client_secret
        )
        return True

    monkeypatch.setattr(service, "test_oidc_connection", _record)

    settings = await service._get_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )
    await service.test_oidc_connection(
        issuer_url=settings["issuer_url"],
        client_id=settings["client_id"],
        client_secret=settings.get("client_secret", ""),
    )

    assert seen["client_secret"] == "super-secret-value-123"
