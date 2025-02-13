import uuid
import json

from agenta_backend.dbs.secrets.dbes import SecretsDBE
from agenta_backend.core.secrets.dtos import (
    HeaderDTO,
    SecretDTO,
    LifecycleDTO,
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


def map_secrets_dto_to_dbe(
    *, project_id: uuid.UUID, secret_dto: CreateSecretDTO
) -> SecretsDBE:
    vault_secret_dbe = SecretsDBE(
        name=secret_dto.header.name if secret_dto.header else None,
        description=(secret_dto.header.description if secret_dto.header else None),
        project_id=project_id,
        kind=secret_dto.secret.kind,
        data=json.dumps(secret_dto.secret.data.model_dump()),
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
                secrets_dbe.data = json.dumps(
                    update_secret_dto.secret.data.model_dump()
                )
            elif hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)


def map_secrets_dbe_to_dto(*, secrets_dbe: SecretsDBE) -> SecretResponseDTO:
    vault_secret_dto = SecretResponseDTO(
        id=secrets_dbe.id,  # type: ignore
        header=HeaderDTO(
            name=secrets_dbe.name, description=secrets_dbe.description  # type: ignore
        ),
        secret=SecretDTO(
            kind=secrets_dbe.kind,
            data=json.loads(secrets_dbe.data),  # type: ignore
        ),
        lifecycle=LifecycleDTO(
            created_at=secrets_dbe.created_at,
            updated_at=secrets_dbe.updated_at,  # type: ignore
        ),
    )
    return vault_secret_dto
