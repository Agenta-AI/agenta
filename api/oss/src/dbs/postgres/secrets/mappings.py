import uuid
import json
from datetime import datetime, timezone

from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.core.secrets.managed import SecretManagementDTO
from oss.src.core.secrets.enums import (
    SecretAvailability,
    SecretOwnerKind,
    is_always_write_only,
)
from oss.src.core.secrets.dtos import (
    SecretOwner,
    Header,
    SecretKind,
    LegacyLifecycleDTO,
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


# Server-controlled metadata rides inside encrypted JSON, so no schema migration is needed.
# Rows without the keys read as management=None, and as write_only=False EXCEPT on a kind the
# server never lets be readable, where the absence is read as write-only instead. See
# `is_always_write_only`: that is what lets an already-stored OAuth grant be safe without a
# migration.
_WRITE_ONLY_KEY = "write_only"
_MANAGEMENT_KEY = "management"


def _data_payload(
    data_json: dict,
    *,
    write_only: bool,
    management: SecretManagementDTO | None = None,
) -> str:
    if write_only:
        data_json[_WRITE_ONLY_KEY] = True
    else:
        data_json.pop(_WRITE_ONLY_KEY, None)

    if management is not None:
        data_json[_MANAGEMENT_KEY] = management.model_dump(mode="json")
    else:
        data_json.pop(_MANAGEMENT_KEY, None)

    return json.dumps(data_json)


def map_secrets_dto_to_dbe(
    *,
    project_id: uuid.UUID | None,
    organization_id: uuid.UUID | None,
    secret_dto: CreateSecretDTO,
    management: SecretManagementDTO | None = None,
) -> SecretsDBE:
    vault_secret_dbe = SecretsDBE(
        slug=secret_dto.slug,
        name=secret_dto.header.name if secret_dto.header else None,
        description=(secret_dto.header.description if secret_dto.header else None),
        project_id=project_id,
        organization_id=organization_id,
        kind=secret_dto.secret.kind.value,
        data=_data_payload(
            # `mode="json"` because the payload is JSON: a field typed as anything but
            # a JSON primitive (a `UUID`, a `datetime`) reaches `json.dumps` as the
            # object itself otherwise and raises. Every field that predates this was
            # already JSON-native, so nothing else renders differently.
            secret_dto.secret.data.model_dump(mode="json", exclude_none=True),
            write_only=bool(secret_dto.write_only),
            management=management,
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

    # Carried over rather than re-decided, because `write_only` is the creator's choice and an
    # update must not change it. The one exception is the kind that may never be readable: a
    # row stored before the rule carries no mark, and writing the payload back without one
    # would keep it unmarked for good. The kind comes off the row, not the request, so a body
    # cannot move a secret into or out of this.
    write_only = is_always_write_only(secrets_dbe.kind) or bool(
        stored_data.get(_WRITE_ONLY_KEY)
    )
    management_data = stored_data.get(_MANAGEMENT_KEY)
    management = (
        SecretManagementDTO.model_validate(management_data)
        if management_data is not None
        else None
    )

    if update_secret_dto.secret:
        for key, value in update_secret_dto.secret.model_dump(
            exclude_none=True
        ).items():
            if key == "data" and hasattr(secrets_dbe, key):
                secrets_dbe.data = _data_payload(
                    update_secret_dto.secret.data.model_dump(mode="json"),
                    write_only=write_only,
                    management=management,
                )
            elif hasattr(secrets_dbe, key):
                setattr(secrets_dbe, key, value)


def _secret_kind(kind) -> SecretKind:
    """The kind as the enum, from the ORM (a member) or from raw SQL (the Postgres enum
    label, which is the member NAME, for example `PROVIDER_KEY`)."""
    if isinstance(kind, SecretKind):
        return kind
    try:
        return SecretKind(kind)
    except ValueError:
        return SecretKind[kind]


def _owner_of(row) -> SecretOwner | None:
    project_id = getattr(row, "project_id", None)
    if project_id is not None:
        return SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
    organization_id = getattr(row, "organization_id", None)
    if organization_id is not None:
        return SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=organization_id)
    return None


def map_secrets_dbe_to_dto(
    *,
    secrets_dbe,
    selected_project_ids: list | None = None,
) -> SecretResponseDTO:
    """Map a stored row (an ORM `SecretsDBE`, or a raw row with the same column names and
    a decrypted `data`) to the trusted DTO, with its owner.

    `availability` is set on organization rows only; `selected_project_ids` only when the
    caller read them (management reads)."""
    data = json.loads(secrets_dbe.data)  # type: ignore
    write_only = bool(data.pop(_WRITE_ONLY_KEY, False))
    management = data.pop(_MANAGEMENT_KEY, None)
    owner = _owner_of(secrets_dbe)

    availability = None
    if owner is not None and owner.kind == SecretOwnerKind.ORGANIZATION:
        availability = SecretAvailability(
            getattr(secrets_dbe, "availability", None)
            or SecretAvailability.ALL_PROJECTS.value
        )

    vault_secret_dto = SecretResponseDTO(
        id=secrets_dbe.id,  # type: ignore
        slug=secrets_dbe.slug,
        kind=_secret_kind(secrets_dbe.kind).value,
        data=data,
        header=Header(name=secrets_dbe.name, description=secrets_dbe.description),
        lifecycle=LegacyLifecycleDTO(
            created_at=str(secrets_dbe.created_at),
            updated_at=str(secrets_dbe.updated_at),
        ),
        write_only=write_only,
        management=management,
        owner=owner,
        availability=availability,
        selected_project_ids=selected_project_ids,
    )

    return vault_secret_dto


def map_create_to_payload(
    *,
    secret_dto: CreateSecretDTO,
    management: SecretManagementDTO | None = None,
) -> str:
    """The plaintext JSON a create stores (encrypted in SQL), the same as the ORM path."""
    return _data_payload(
        secret_dto.secret.data.model_dump(mode="json", exclude_none=True),
        write_only=bool(secret_dto.write_only),
        management=management,
    )
