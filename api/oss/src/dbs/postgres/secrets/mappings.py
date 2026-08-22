import uuid
import json
from datetime import datetime, timezone

from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.core.secrets.managed import resolve_managed_by
from oss.src.core.secrets.dtos import (
    Header,
    SecretKind,
    LegacyLifecycleDTO,
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


# Both server-controlled attributes ride inside the (encrypted) `data` JSON, as siblings
# of the payload fields, so no schema migration is needed. They are popped back out in
# `map_secrets_dbe_to_dto`, so payload DTOs never see them; rows without the keys read as
# write_only=False and managed_by=None (legacy, and every user-created row).
_WRITE_ONLY_KEY = "write_only"
_MANAGED_BY_KEY = "managed_by"


def _data_payload(
    data_json: dict,
    *,
    write_only: bool,
    managed_by: str | None = None,
) -> str:
    if write_only:
        data_json[_WRITE_ONLY_KEY] = True
    else:
        data_json.pop(_WRITE_ONLY_KEY, None)

    if managed_by:
        data_json[_MANAGED_BY_KEY] = managed_by
    else:
        data_json.pop(_MANAGED_BY_KEY, None)

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
            managed_by=secret_dto.managed_by,
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

    stored_data = json.loads(secrets_dbe.data)

    write_only = bool(stored_data.get(_WRITE_ONLY_KEY))
    # Same reason to resolve it here: `data` is rewritten wholesale below, so an omitted
    # marker would silently un-manage the row. Only an in-process owner can reach this
    # with a non-None value (`VaultService.update_secret` refuses it otherwise).
    managed_by = resolve_managed_by(
        stored=stored_data.get(_MANAGED_BY_KEY),
        requested=update_secret_dto.managed_by,
    )

    if update_secret_dto.secret:
        for key, value in update_secret_dto.secret.model_dump(
            exclude_none=True
        ).items():
            if key == "data" and hasattr(secrets_dbe, key):
                secrets_dbe.data = _data_payload(
                    update_secret_dto.secret.data.model_dump(),
                    write_only=write_only,
                    managed_by=managed_by,
                )
            elif hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)
    elif update_secret_dto.managed_by is not None:
        secrets_dbe.data = _data_payload(
            stored_data,
            write_only=write_only,
            managed_by=managed_by,
        )


def map_secrets_dbe_to_dto(*, secrets_dbe: SecretsDBE) -> SecretResponseDTO:
    data = json.loads(secrets_dbe.data)  # type: ignore
    write_only = bool(data.pop(_WRITE_ONLY_KEY, False))
    managed_by = data.pop(_MANAGED_BY_KEY, None) or None

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
        managed_by=managed_by,
    )

    return vault_secret_dto
