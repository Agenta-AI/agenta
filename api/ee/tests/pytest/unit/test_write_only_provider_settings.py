"""EE organization-provider responses respect write-only SSO secrets.

`_get_provider_settings` feeds the user-facing provider serialization; once the vault
record is write-only it must drop `client_secret` while keeping the non-secret settings.
The login-time reader (SuperTokens overrides) resolves through `VaultService` directly and
is unaffected.
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


@pytest.mark.asyncio
async def test_write_only_sso_secret_drops_client_secret_from_settings(monkeypatch):
    monkeypatch.setattr(
        OrganizationProvidersService,
        "_vault_service",
        staticmethod(lambda: _StubVaultService(_sso_secret(write_only=True))),
    )

    settings = await OrganizationProvidersService()._get_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )

    assert settings.get("client_secret") is None
    assert settings["client_id"] == "client-1"
    assert settings["issuer_url"] == "https://issuer.example.com"


@pytest.mark.asyncio
async def test_readable_sso_secret_keeps_todays_settings(monkeypatch):
    monkeypatch.setattr(
        OrganizationProvidersService,
        "_vault_service",
        staticmethod(lambda: _StubVaultService(_sso_secret(write_only=False))),
    )

    settings = await OrganizationProvidersService()._get_provider_settings(
        str(ORGANIZATION_ID), str(SECRET_ID)
    )

    assert settings["client_secret"] == "super-secret-value-123"
