import uuid
import json
from datetime import datetime, timezone

from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.core.secrets.dtos import (
    Header,
    SecretKind,
    LegacyLifecycleDTO,
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


# The flag rides inside the (encrypted) `data` JSON, as a sibling of the payload fields,
# so no schema migration is needed. It is popped back out in `map_secrets_dbe_to_dto`, so
# payload DTOs never see it; rows without the key read as write_only=False (legacy).
_WRITE_ONLY_KEY = "write_only"


def _data_payload(data_json: dict, *, write_only: bool) -> str:
    if write_only:
        data_json[_WRITE_ONLY_KEY] = True
    else:
        data_json.pop(_WRITE_ONLY_KEY, None)

    return json.dumps(data_json)


def map_secrets_dto_to_dbe(
    *,
    project_id: uuid.UUID | None,
    organization_id: uuid.UUID | None,
    secret_dto: CreateSecretDTO,
) -> SecretsDBE:
    vault_secret_dbe = SecretsDBE(
        slug=secret_dto.slug,
        name=secret_dto.header.name if secret_dto.header else None,
        description=(secret_dto.header.description if secret_dto.header else None),
        project_id=project_id,
        organization_id=organization_id,
        kind=secret_dto.secret.kind.value,
        data=_data_payload(
            secret_dto.secret.data.model_dump(exclude_none=True),
            write_only=bool(secret_dto.write_only),
        ),
    )
    return vault_secret_dbe


def map_secrets_dto_to_dbe_update(
    secrets_dbe: SecretsDBE,
    update_secret_dto: UpdateSecretDTO,
    user_id=None,
) -> None:
    secrets_dbe.updated_at = datetime.now(timezone.utc)
    secrets_dbe.updated_by_id = user_id

    if update_secret_dto.header:
        for key, value in update_secret_dto.header.model_dump(
            exclude_none=True
        ).items():
            if hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)

    # Resolve the effective flag BEFORE overwriting data: a None on the update DTO means
    # "keep the stored flag" (the service only sets it for explicit transitions).
    write_only = update_secret_dto.write_only
    if write_only is None:
        write_only = bool(json.loads(secrets_dbe.data).get(_WRITE_ONLY_KEY))

    if update_secret_dto.secret:
        for key, value in update_secret_dto.secret.model_dump(
            exclude_none=True
        ).items():
            if key == "data" and hasattr(secrets_dbe, key):
                secrets_dbe.data = _data_payload(
                    update_secret_dto.secret.data.model_dump(),
                    write_only=write_only,
                )
            elif hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)
    elif update_secret_dto.write_only is not None:
        secrets_dbe.data = _data_payload(
            json.loads(secrets_dbe.data),
            write_only=write_only,
        )


def map_secrets_dbe_to_dto(*, secrets_dbe: SecretsDBE) -> SecretResponseDTO:
    data = json.loads(secrets_dbe.data)  # type: ignore
    write_only = bool(data.pop(_WRITE_ONLY_KEY, False))

    vault_secret_dto = SecretResponseDTO(
        id=secrets_dbe.id,  # type: ignore
        slug=secrets_dbe.slug,
        kind=SecretKind(secrets_dbe.kind).value,
        data=data,
        header=Header(name=secrets_dbe.name, description=secrets_dbe.description),
        lifecycle=LegacyLifecycleDTO(
            created_at=str(secrets_dbe.created_at),
            updated_at=str(secrets_dbe.updated_at),
        ),
        write_only=write_only,
    )

    return vault_secret_dto
