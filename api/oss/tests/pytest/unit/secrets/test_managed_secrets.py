from uuid import uuid4
import json

import pytest
from pydantic import ValidationError

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.managed import (
    ManagedSecretReadOnlyError,
    SecretManagementDTO,
    SecretManagementPolicy,
    SecretManager,
)
from oss.src.core.secrets.redaction import project_secret_response
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
)


PROJECT_ID = uuid4()


def _create(*, write_only=False):
    return CreateSecretDTO(
        header={"name": "Managed"},
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": "sk-managed"}},
        },
        write_only=write_only,
    )


def _management():
    return SecretManagementDTO(manager=SecretManager.STARTER_CREDITS_BRIDGE)


class _DAO:
    def __init__(self):
        self.record = None

    async def create(
        self, project_id, organization_id, create_secret_dto, management=None
    ):
        self.record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data,
            header=create_secret_dto.header,
            write_only=create_secret_dto.write_only,
            management=management,
        )
        return self.record

    async def list(self, project_id, organization_id):
        return [self.record] if self.record else []

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        if resolve_update:
            update_secret_dto = resolve_update(self.record, update_secret_dto)
        return self.record

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        if authorize_delete:
            authorize_delete(self.record)
        self.record = None


def test_management_models_are_exact():
    management = _management()
    assert management.manager is SecretManager.STARTER_CREDITS_BRIDGE
    assert management.policy is SecretManagementPolicy.MANAGER_ONLY


@pytest.mark.parametrize("dto", [CreateSecretDTO, UpdateSecretDTO])
def test_public_write_models_reject_management_fields(dto):
    payload = {"management": {"manager": "starter-credits-bridge"}}
    if dto is CreateSecretDTO:
        payload.update(_create().model_dump())
    with pytest.raises(ValidationError):
        dto.model_validate(payload)


@pytest.mark.asyncio
async def test_readable_managed_secret_is_allowed_and_locked():
    service = VaultService(_DAO())
    created = await service.create_managed_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_create(write_only=False),
        management=_management(),
    )
    assert created.write_only is False
    assert created.management == _management()

    with pytest.raises(ManagedSecretReadOnlyError):
        await service.update_secret(
            created.id,
            UpdateSecretDTO(header={"name": "No"}),
            project_id=PROJECT_ID,
        )
    with pytest.raises(ManagedSecretReadOnlyError):
        await service.delete_secret(created.id, project_id=PROJECT_ID)


def test_public_projection_exposes_policy_but_not_manager():
    secret = SecretResponseDTO(
        id=uuid4(),
        slug="managed",
        kind="provider_key",
        data={"kind": "openai", "provider": {"key": "sk-managed"}},
        header={"name": "Managed"},
        write_only=False,
        management=_management(),
    )
    public = project_secret_response(secret, reveal_write_only=True)
    dumped = public.model_dump(mode="json", exclude_none=True)
    assert dumped["management"] == {"policy": "manager_only"}
    assert "manager" not in dumped["management"]


def test_mapping_round_trip_uses_structured_management_without_flat_fallback():
    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_create(write_only=False),
        management=_management(),
    )
    assert '"management"' in dbe.data
    assert '"managed_by"' not in dbe.data
    restored = map_secrets_dbe_to_dto(secrets_dbe=dbe)
    assert restored.management == _management()
    assert restored.write_only is False

    payload = json.loads(dbe.data)
    payload.pop("management")
    payload["managed_by"] = "starter-credits-bridge"
    dbe.data = json.dumps(payload)
    legacy = map_secrets_dbe_to_dto(secrets_dbe=dbe)
    assert legacy.management is None
