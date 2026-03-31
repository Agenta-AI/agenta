import uuid
import json

from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.core.secrets.dtos import (
    Header,
    SecretKind,
    LegacyLifecycleDTO,
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


def map_secrets_dto_to_dbe(
    *,
    project_id: uuid.UUID | None,
    organization_id: uuid.UUID | None,
    secret_dto: CreateSecretDTO,
) -> SecretsDBE:
    vault_secret_dbe = SecretsDBE(
        name=secret_dto.header.name if secret_dto.header else None,
        description=(secret_dto.header.description if secret_dto.header else None),
        project_id=project_id,
        organization_id=organization_id,
        kind=secret_dto.secret.kind.value,
        data=json.dumps(secret_dto.secret.data.model_dump(exclude_none=True)),
    )
    return vault_secret_dbe


def map_secrets_dto_to_dbe_update(
    secrets_dbe: SecretsDBE, update_secret_dto: UpdateSecretDTO
) -> None:
    if update_secret_dto.header:
        for key, value in update_secret_dto.header.model_dump(
            exclude_none=True
        ).items():
            if hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)

    if update_secret_dto.secret:
        for key, value in update_secret_dto.secret.model_dump(
            exclude_none=True
        ).items():
            if key == "data" and hasattr(secrets_dbe, key):
                secrets_dbe.data = update_secret_dto.secret.data.model_dump_json()
            elif hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)


def map_secrets_dbe_to_dto(*, secrets_dbe: SecretsDBE) -> SecretResponseDTO:
    vault_secret_dto = SecretResponseDTO(
        id=secrets_dbe.id,  # type: ignore
        kind=SecretKind(secrets_dbe.kind).value,
        data=json.loads(secrets_dbe.data),  # type: ignore
        header=Header(name=secrets_dbe.name, description=secrets_dbe.description),
        lifecycle=LegacyLifecycleDTO(
            created_at=str(secrets_dbe.created_at),
            updated_at=str(secrets_dbe.updated_at),
        ),
    )

    return vault_secret_dto
