from typing import Any, Optional
from uuid import UUID, uuid4

from oss.src.utils.env import env
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.core.secrets.enums import (
    STANDARD_PROVIDER_DISPLAY_NAMES,
    SecretKind,
    StandardProviderKind,
)
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.redaction import (
    CREDENTIAL_EXTRAS_KEYS,
    PRIMARY_CREDENTIAL_FIELDS,
)
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
    WriteOnlyCannotBeDisabledError,
)


def next_provider_key_name(
    *,
    kind: StandardProviderKind,
    taken_names: set[str],
) -> str:
    """The first free display name for a new connection of ``kind``.

    The first connection of a provider family takes the plain display name ("OpenAI"), later
    ones get a suffix ("OpenAI 2", "OpenAI 3"). The name is display only; the slug is identity.
    """
    title = STANDARD_PROVIDER_DISPLAY_NAMES.get(kind, kind.value)

    if title not in taken_names:
        return title

    index = 2
    while f"{title} {index}" in taken_names:
        index += 1

    return f"{title} {index}"


def _provider_family(data: Any) -> Optional[str]:
    """The provider family (`data.kind`) as a canonical string; None for family-less kinds."""
    kind = getattr(data, "kind", None)
    if kind is None:
        return None
    return str(getattr(kind, "value", kind))


def _carry_over_saved_value(*, kind: str, stored_data: Any, update_data: Any) -> None:
    """Fill an update payload's omitted value field from the stored record.

    An update that omits the value means "keep the stored one" — the contract replace-only
    forms rely on for write-only secrets, applied uniformly so update semantics do not fork
    on the flag. An empty string counts as omitted: an empty credential is never a
    meaningful value, and replace-only forms submit empty for "unchanged".

    Only called when the update keeps the stored kind AND provider family — a credential
    must never silently cross identities (see `update_secret`).
    """
    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(kind, (None, None))

    if container_name is not None:
        update_container = getattr(update_data, container_name, None)
        stored_container = getattr(stored_data, container_name, None)

        if (
            update_container is not None
            and stored_container is not None
            and hasattr(update_container, field)
        ):
            current_value = getattr(update_container, field)
            if current_value is None or current_value == "":
                stored_value = getattr(stored_container, field, None)
                if stored_value is not None:
                    setattr(update_container, field, stored_value)

    _carry_over_saved_extras(stored_data=stored_data, update_data=update_data)


def _require_explicit_value(*, secret: Any) -> None:
    """Reject a kind/family-changing update that carries no new credential value."""
    kind = str(secret.kind.value)
    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(kind, (None, None))
    if container_name is None:
        return

    container = getattr(secret.data, container_name, None)
    value = getattr(container, field, None) if container is not None else None
    has_value = value is not None and value != ""

    if not has_value and container is not None:
        extras = getattr(container, "extras", None) or {}
        has_value = any(
            extras.get(extras_key) not in (None, "")
            for extras_key in CREDENTIAL_EXTRAS_KEYS
        )

    if not has_value:
        raise SecretValueRequiredError()


def _carry_over_saved_extras(*, stored_data: Any, update_data: Any) -> None:
    """Same keep-on-omit contract for the credential keys of a custom provider's extras."""
    update_container = getattr(update_data, "provider", None)
    stored_container = getattr(stored_data, "provider", None)

    if update_container is None or stored_container is None:
        return
    if not hasattr(update_container, "extras"):
        return

    stored_extras = getattr(stored_container, "extras", None) or {}
    if not stored_extras:
        return

    update_extras = update_container.extras
    if update_extras is None:
        update_container.extras = dict(stored_extras)
        return

    for extras_key in CREDENTIAL_EXTRAS_KEYS:
        stored_value = stored_extras.get(extras_key)
        if stored_value is not None and not update_extras.get(extras_key):
            update_extras[extras_key] = stored_value


def _carry_over_saved_policy(*, stored_data: Any, update_data: Any) -> None:
    """Fill an update payload's omitted ``models``/``harnesses`` from the stored record.

    The two fields are policy edited on their own surface (the connection drawer), so an update
    from another surface — renaming the connection, rotating its key — omits them and must not
    wipe them. An explicit empty list is a choice ("offer nothing") and is left alone.
    """
    for field in ("models", "harnesses"):
        if not hasattr(update_data, field) or getattr(update_data, field) is not None:
            continue

        stored_value = getattr(stored_data, field, None)

        if stored_value is not None:
            setattr(update_data, field, stored_value)


class VaultService:
    def __init__(self, secrets_dao: SecretsDAOInterface):
        self.secrets_dao = secrets_dao
        self._data_encryption_key = env.agenta.crypt_key

    async def create_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
    ):
        # custom_secret and custom_provider are addressed by slug; derive one from the name when
        # absent so the record keeps its identity when the display name later changes.
        if (
            not create_secret_dto.slug
            and create_secret_dto.secret.kind
            in (SecretKind.CUSTOM_SECRET, SecretKind.CUSTOM_PROVIDER)
            and create_secret_dto.header
            and create_secret_dto.header.name
        ):
            create_secret_dto.slug = get_slug_from_name_and_id(
                create_secret_dto.header.name,
                uuid4(),
            )

        # The write-only default for NEW secrets is env-gated (off until the web UI ships
        # replace-only secret forms); an explicit request value always wins. Existing rows
        # are untouched (they carry no flag).
        if create_secret_dto.write_only is None:
            create_secret_dto.write_only = env.agenta.vault.write_only_default

        if create_secret_dto.secret.kind == SecretKind.PROVIDER_KEY:
            await self._name_and_slug_provider_key(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.create(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )
            return secret_dto

    async def _name_and_slug_provider_key(
        self,
        *,
        project_id: UUID | None,
        organization_id: UUID | None,
        create_secret_dto: CreateSecretDTO,
    ) -> None:
        """Give a new provider_key connection a display name and a stable slug.

        Several connections may exist per provider family, so identity is the slug, not the
        provider. An unnamed connection is named after its provider ("OpenAI", then "OpenAI 2"),
        computed here rather than client-side because two clients can create at the same time.
        Existing records keep their missing slug and resolve by provider family.
        """
        header = create_secret_dto.header

        if not header.name:
            with set_data_encryption_key(
                data_encryption_key=self._data_encryption_key,
            ):
                secrets_dtos = await self.secrets_dao.list(
                    project_id=project_id,
                    organization_id=organization_id,
                )

            header.name = next_provider_key_name(
                kind=create_secret_dto.secret.data.kind,
                taken_names={
                    secret_dto.header.name
                    for secret_dto in secrets_dtos or []
                    if secret_dto.kind == SecretKind.PROVIDER_KEY
                    and secret_dto.header.name
                },
            )

        if not create_secret_dto.slug:
            create_secret_dto.slug = get_slug_from_name_and_id(
                header.name,
                uuid4(),
            )

    async def get_secret_by_id(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.get_by_id(
                secret_id=secret_id,
                project_id=project_id,
                organization_id=organization_id,
            )
            return secret_dto

    async def get_secret_by_slug(
        self,
        secret_slug: str,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            return await self.secrets_dao.get_by_slug(
                secret_slug=secret_slug,
                project_id=project_id,
                organization_id=organization_id,
            )

    async def list_secrets(
        self,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secrets_dtos = await self.secrets_dao.list(
                project_id=project_id,
                organization_id=organization_id,
            )
            return secrets_dtos

    async def update_secret(
        self,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        user_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            if (
                update_secret_dto.secret is not None
                or update_secret_dto.write_only is not None
            ):
                stored_secret_dto = await self.secrets_dao.get_by_id(
                    secret_id=secret_id,
                    project_id=project_id,
                    organization_id=organization_id,
                )
                if stored_secret_dto is not None:
                    if (
                        stored_secret_dto.write_only
                        and update_secret_dto.write_only is False
                    ):
                        raise WriteOnlyCannotBeDisabledError()

                    if update_secret_dto.secret is not None:
                        # Keep-on-omit is an identity-local contract: a stored credential
                        # never silently becomes another kind's or another provider's
                        # credential. Changing either requires an explicit new value.
                        same_identity = stored_secret_dto.kind == (
                            update_secret_dto.secret.kind
                        ) and _provider_family(
                            stored_secret_dto.data
                        ) == _provider_family(update_secret_dto.secret.data)

                        if same_identity:
                            _carry_over_saved_policy(
                                stored_data=stored_secret_dto.data,
                                update_data=update_secret_dto.secret.data,
                            )
                            _carry_over_saved_value(
                                kind=str(stored_secret_dto.kind.value),
                                stored_data=stored_secret_dto.data,
                                update_data=update_secret_dto.secret.data,
                            )
                        else:
                            _require_explicit_value(secret=update_secret_dto.secret)

            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                project_id=project_id,
                organization_id=organization_id,
                user_id=user_id,
            )
            return secret_dto

    async def delete_secret(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> None:
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            await self.secrets_dao.delete(
                secret_id=secret_id,
                project_id=project_id,
                organization_id=organization_id,
            )
            return
