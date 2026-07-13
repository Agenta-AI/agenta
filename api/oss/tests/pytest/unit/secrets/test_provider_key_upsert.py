from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    Header,
    SecretDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.secrets.services import VaultService


class _FakeSecretsDAO:
    def __init__(self):
        self.created = []
        self.updated = []
        self._secrets = []

    async def list(self, project_id=None, organization_id=None):
        del project_id, organization_id
        return list(self._secrets)

    async def create(
        self, project_id=None, organization_id=None, create_secret_dto=None
    ):
        del project_id, organization_id
        secret = SimpleNamespace(
            id=uuid4(),
            kind=SecretKind.PROVIDER_KEY,
            data=create_secret_dto.secret.data,
            header=create_secret_dto.header,
        )
        self._secrets.append(secret)
        self.created.append(secret)
        return secret

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id=None,
        organization_id=None,
        user_id=None,
    ):
        del project_id, organization_id, user_id
        self.updated.append(secret_id)
        for secret in self._secrets:
            if secret.id == secret_id:
                secret.data = update_secret_dto.secret.data
                secret.header = update_secret_dto.header
                return secret
        return None


def _anthropic_payload(api_key: str) -> CreateSecretDTO:
    return CreateSecretDTO(
        header=Header(name="Anthropic"),
        secret=SecretDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.ANTHROPIC,
                provider=StandardProviderSettingsDTO(key=api_key),
            ),
        ),
    )


@pytest.fixture
def vault_service(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.secrets.services.env",
        SimpleNamespace(agenta=SimpleNamespace(crypt_key="test-key")),
    )
    dao = _FakeSecretsDAO()
    return VaultService(dao), dao


@pytest.mark.asyncio
async def test_create_provider_key_upserts_instead_of_duplicating(vault_service):
    service, dao = vault_service
    project_id = uuid4()

    first = await service.create_secret(
        project_id=project_id,
        create_secret_dto=_anthropic_payload("sk-ant-1"),
    )
    second = await service.create_secret(
        project_id=project_id,
        create_secret_dto=_anthropic_payload("sk-ant-2"),
    )

    assert len(dao.created) == 1
    assert len(dao.updated) == 1
    assert first.id == second.id
    assert len(dao._secrets) == 1
    assert dao._secrets[0].data.provider.key == "sk-ant-2"


@pytest.mark.asyncio
async def test_create_different_provider_kinds_are_not_upserted(vault_service):
    service, dao = vault_service
    project_id = uuid4()

    await service.create_secret(
        project_id=project_id,
        create_secret_dto=_anthropic_payload("sk-ant-1"),
    )
    await service.create_secret(
        project_id=project_id,
        create_secret_dto=CreateSecretDTO(
            header=Header(name="OpenAI"),
            secret=SecretDTO(
                kind=SecretKind.PROVIDER_KEY,
                data=StandardProviderDTO(
                    kind=StandardProviderKind.OPENAI,
                    provider=StandardProviderSettingsDTO(key="sk-openai-1"),
                ),
            ),
        ),
    )

    assert len(dao.created) == 2
    assert len(dao.updated) == 0
    assert len(dao._secrets) == 2
