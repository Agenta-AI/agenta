from typing import Any, Callable, Optional
from uuid import UUID, uuid4

from pydantic import ValidationError

from oss.src.utils.env import env
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.core.secrets.enums import (
    STANDARD_PROVIDER_DISPLAY_NAMES,
    SUBSCRIPTION_PROVIDER_DISPLAY_NAMES,
    SecretKind,
    StandardProviderKind,
    SubscriptionProviderKind,
)
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.redaction import (
    CREDENTIAL_EXTRAS_KEYS,
    PRIMARY_CREDENTIAL_FIELDS,
)
from oss.src.core.secrets.types import (
    ServerOwnedFieldNotWritable,
    SubscriptionProviderConflict,
)
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    subscription_provider_slug,
    SecretResponseDTO,
    SecretDTO,
    UpdateSecretPayloadDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
)

from oss.src.core.secrets.managed import (
    ManagedSecretReadOnlyError,
    SecretManagementDTO,
    SecretManager,
)


_BLANK_CREDENTIAL_VALUE_MESSAGE = (
    "Credential values cannot be blank. Omit an unchanged credential field or provide a new "
    "value."
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


def _secret_format(data: Any) -> Optional[str]:
    """A custom secret's stored format (`data.secret.format`); None for other kinds.

    Part of a secret's identity for the same reason the provider family is: the format
    decides how the value is validated and read back, so text and json are two different
    credentials, not two spellings of one.
    """
    container = getattr(data, "secret", None)
    fmt = getattr(container, "format", None) if container is not None else None
    if fmt is None:
        return None
    return str(getattr(fmt, "value", fmt))


# Fields the server owns on a subscription connection. The sign-in routes are the only
# writers: a create or an update that states one is refused, and one that omits it keeps
# the stored value, so a rename does not reset the connection to "never signed in".
SERVER_OWNED_DATA_FIELDS = {
    SecretKind.SUBSCRIPTION_PROVIDER.value: (
        "login",
        "login_attempt",
        "login_version",
        "login_generation",
        "login_state",
        "login_error",
    ),
}


def reject_server_owned_fields(*, secret: Any) -> None:
    """Refuse a payload that states a field only the sign-in routes may write."""
    if secret is None:
        return

    kind = getattr(secret, "kind", None)
    owned = SERVER_OWNED_DATA_FIELDS.get(str(getattr(kind, "value", kind)), ())
    if not owned:
        return

    stated = getattr(secret.data, "model_fields_set", set())
    written = [field for field in owned if field in stated]
    if written:
        raise ServerOwnedFieldNotWritable(fields=written)


def _carry_over_saved_value(*, kind: str, stored_data: Any, update_data: Any) -> None:
    """Fill an update payload's omitted value field from the stored record.

    An update that omits the value means "keep the stored one" — the contract replace-only
    forms rely on for write-only secrets, applied uniformly so update semantics do not fork
    on the flag. An explicit empty string is invalid; replace-only forms must omit an
    unchanged credential field.

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
            if current_value == "":
                raise SecretValueRequiredError(message=_BLANK_CREDENTIAL_VALUE_MESSAGE)
            if current_value is None:
                stored_value = getattr(stored_container, field, None)
                if stored_value is not None:
                    setattr(update_container, field, stored_value)

    _carry_over_saved_server_state(
        kind=kind,
        stored_data=stored_data,
        update_data=update_data,
    )
    _carry_over_saved_extras(stored_data=stored_data, update_data=update_data)


def _carry_over_saved_server_state(
    *,
    kind: str,
    stored_data: Any,
    update_data: Any,
) -> None:
    """Keep-on-omit for the server-owned fields that live on the data object itself.

    Omission is read from the payload's own field set, not from the value, because the
    login write paths clear an attempt with an explicit null and that clear must survive.
    """
    for field in SERVER_OWNED_DATA_FIELDS.get(kind, ()):
        if not hasattr(update_data, field):
            continue
        if field in update_data.model_fields_set:
            continue

        stored_value = getattr(stored_data, field, None)
        if stored_value is not None:
            setattr(update_data, field, stored_value)


def _revalidate_merged_secret(*, secret: Any) -> UpdateSecretPayloadDTO:
    """Re-run the payload validators over the update as it will be stored.

    Validation runs at construction, before keep-on-omit fills the value in, so a merged
    payload can be a shape no create would have accepted. Re-validating here — inside the
    write lock, against the merged result — is what keeps an invalid row from being
    committed.
    """
    try:
        complete = SecretDTO.model_validate(secret.model_dump(mode="python"))
        return UpdateSecretPayloadDTO.model_validate(complete.model_dump(mode="python"))
    except ValidationError as exc:
        raise SecretValueRequiredError(
            message=(
                "the stored value does not fit this update's shape; "
                "provide the value explicitly"
            )
        ) from exc


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
        requested_value = update_extras.get(extras_key)
        if requested_value == "":
            raise SecretValueRequiredError(message=_BLANK_CREDENTIAL_VALUE_MESSAGE)
        if stored_value is not None and (
            extras_key not in update_extras or requested_value is None
        ):
            update_extras[extras_key] = stored_value


def _resolve_update(
    stored_secret_dto: SecretResponseDTO,
    requested_update: UpdateSecretDTO,
) -> UpdateSecretDTO:
    """Resolve a CALLER update: a managed row is read-only, every other row merges."""
    if stored_secret_dto.management is not None:
        raise ManagedSecretReadOnlyError()

    return _merge_update(stored_secret_dto, requested_update)


def _resolve_managed_update(manager: SecretManager):
    """Resolve an update issued by a managed row's OWN manager.

    The read-only rule exists so a caller cannot edit a row the platform owns. It must not
    stop the owning manager itself from repairing that row: a seeded value can go stale
    (the funded model of a starter-credits connection, say), and only the manager knows
    the current one. The merge below is the same one every other update runs.
    """

    def resolve(
        stored_secret_dto: SecretResponseDTO,
        requested_update: UpdateSecretDTO,
    ) -> UpdateSecretDTO:
        management = stored_secret_dto.management

        if management is None or management.manager != manager:
            raise ManagedSecretReadOnlyError()

        return _merge_update(stored_secret_dto, requested_update)

    return resolve


def _merge_update(
    stored_secret_dto: SecretResponseDTO,
    requested_update: UpdateSecretDTO,
) -> UpdateSecretDTO:
    """Fill this update's omitted credential from the row UNDER THE WRITE LOCK.

    Called by the DAO inside the locked transaction rather than by the service before it,
    because a value carried over from a snapshot read earlier is a value another writer
    may already have replaced: a rotation that commits in between would be silently
    undone, the update writing the older credential back over the newer one.

    Keep-on-omit is also identity-local — a stored credential never silently becomes
    another kind's or another provider's credential — and that decision reads the same
    stored row, so it belongs under the same lock.
    """
    resolved_update = requested_update.model_copy(deep=True)
    if resolved_update.secret is None:
        return UpdateSecretDTO.model_validate(resolved_update.model_dump(mode="python"))

    same_identity = (
        stored_secret_dto.kind == resolved_update.secret.kind
        and _provider_family(stored_secret_dto.data)
        == _provider_family(resolved_update.secret.data)
        # A custom secret's format is identity too: carrying a stored text value into a
        # json update would store a string where the shape says object, and the payload
        # validators never see it because they ran before the value was filled in.
        and _secret_format(stored_secret_dto.data)
        == _secret_format(resolved_update.secret.data)
    )

    if same_identity:
        _carry_over_saved_policy(
            stored_data=stored_secret_dto.data,
            update_data=resolved_update.secret.data,
        )
        _carry_over_saved_value(
            kind=str(stored_secret_dto.kind.value),
            stored_data=stored_secret_dto.data,
            update_data=resolved_update.secret.data,
        )
        _carry_over_custom_secret_metadata(
            stored_data=stored_secret_dto.data,
            update_data=resolved_update.secret.data,
        )
        # The payload was validated before the carry-over filled it in, so what the
        # validators actually saw was a value-less shape. Re-validate the merged result:
        # nothing reaches the row that a create of the same shape would have refused.
        resolved_update.secret = _revalidate_merged_secret(
            secret=resolved_update.secret
        )
    else:
        _require_explicit_value(secret=resolved_update.secret)

    return UpdateSecretDTO.model_validate(resolved_update.model_dump(mode="python"))


def _carry_over_custom_secret_metadata(*, stored_data: Any, update_data: Any) -> None:
    stored = getattr(stored_data, "secret", None)
    requested = getattr(update_data, "secret", None)
    if stored is None or requested is None:
        return
    if "default_env_var" not in requested.model_fields_set:
        requested.default_env_var = stored.default_env_var


def _authorize_delete(stored_secret_dto: SecretResponseDTO) -> None:
    if stored_secret_dto.management is not None:
        raise ManagedSecretReadOnlyError()


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
        return await self._create_secret(
            project_id=project_id,
            organization_id=organization_id,
            create_secret_dto=create_secret_dto,
            management=None,
        )

    async def create_managed_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
        management: SecretManagementDTO,
    ):
        return await self._create_secret(
            project_id=project_id,
            organization_id=organization_id,
            create_secret_dto=create_secret_dto,
            management=management,
        )

    async def _create_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
        management: SecretManagementDTO | None,
    ):
        reject_server_owned_fields(secret=create_secret_dto.secret)

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

        if create_secret_dto.secret.kind == SecretKind.PROVIDER_KEY:
            await self._name_and_slug_provider_key(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )

        if create_secret_dto.secret.kind == SecretKind.SUBSCRIPTION_PROVIDER:
            await self._name_and_slug_subscription_provider(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            if management is None:
                secret_dto = await self.secrets_dao.create(
                    project_id=project_id,
                    organization_id=organization_id,
                    create_secret_dto=create_secret_dto,
                )
            else:
                secret_dto = await self.secrets_dao.create(
                    project_id=project_id,
                    organization_id=organization_id,
                    create_secret_dto=create_secret_dto,
                    management=management,
                )

        if project_id is not None:
            await invalidate_cache(project_id=str(project_id))
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

    async def _name_and_slug_subscription_provider(
        self,
        *,
        project_id: UUID | None,
        organization_id: UUID | None,
        create_secret_dto: CreateSecretDTO,
    ) -> None:
        """Name and slug a new subscription connection, and refuse a duplicate provider.

        One connection per provider per project is the whole model for now, so the slug is
        the provider id itself and a second one is a conflict rather than a second row. The
        unique index on (project_id, slug) would refuse it too, but as an integrity error
        the caller cannot act on.
        """
        provider = create_secret_dto.secret.data.provider
        provider_kind = SubscriptionProviderKind(getattr(provider, "value", provider))

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secrets_dtos = await self.secrets_dao.list(
                project_id=project_id,
                organization_id=organization_id,
            )

        for secret_dto in secrets_dtos or []:
            if secret_dto.kind != SecretKind.SUBSCRIPTION_PROVIDER:
                continue
            stored_provider = getattr(secret_dto.data, "provider", None)
            if (
                getattr(stored_provider, "value", stored_provider)
                == provider_kind.value
            ):
                raise SubscriptionProviderConflict(provider=provider_kind.value)

        header = create_secret_dto.header
        if not header.name:
            header.name = SUBSCRIPTION_PROVIDER_DISPLAY_NAMES[provider_kind]

        if not create_secret_dto.slug:
            create_secret_dto.slug = provider_kind.value

        create_secret_dto.secret.data.provider_slug = subscription_provider_slug(
            header.name
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
        if project_id is not None:
            secrets_dtos = await get_cache(
                namespace="list_secrets",
                project_id=str(project_id),
                key={},
                model=SecretResponseDTO,
                is_list=True,
            )
            if secrets_dtos is not None:
                return secrets_dtos

        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            secrets_dtos = await self.secrets_dao.list(
                project_id=project_id, organization_id=organization_id
            )

        if project_id is not None:
            await set_cache(
                namespace="list_secrets",
                project_id=str(project_id),
                key={},
                value=secrets_dtos,
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
        reject_server_owned_fields(secret=update_secret_dto.secret)

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                project_id=project_id,
                organization_id=organization_id,
                user_id=user_id,
                resolve_update=_resolve_update,
            )

        if project_id is not None:
            await invalidate_cache(project_id=str(project_id))
        return secret_dto

    async def update_secret_atomically(
        self,
        *,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        user_id: UUID | None = None,
        resolve_update: Callable[[SecretResponseDTO], Optional[UpdateSecretDTO]],
    ):
        """Apply an update computed from the stored row under the DAO's write lock.

        The subscription login writes decide WHAT to store by comparing the pushed login
        with the stored one. Two runners can push at the same time, so that comparison has
        to read the row the write commits, not a snapshot taken before it.

        A resolver that returns None means the row already holds what the caller wanted.
        Nothing is written and the project cache keeps its entry, so a device login poll
        every two seconds does not evict every reader's view of the vault.
        """
        changed = False

        def resolve(stored: SecretResponseDTO, _requested: UpdateSecretDTO):
            nonlocal changed
            update = resolve_update(stored)
            changed = update is not None
            return update

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=UpdateSecretDTO(),
                project_id=project_id,
                organization_id=organization_id,
                user_id=user_id,
                resolve_update=resolve,
            )

        if changed and project_id is not None:
            await invalidate_cache(project_id=str(project_id))
        return secret_dto

    async def update_managed_secret(
        self,
        *,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        manager: SecretManager,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        """Rewrite a managed row on behalf of the manager that owns it.

        Refuses any row another manager owns, and any unmanaged row: this path exists to
        repair what the platform seeded, never to edit what a user saved.
        """
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                project_id=project_id,
                organization_id=organization_id,
                resolve_update=_resolve_managed_update(manager),
            )

        if project_id is not None:
            await invalidate_cache(project_id=str(project_id))
        return secret_dto

    async def invalidate_secrets_cache(self, project_id: UUID) -> None:
        """Drop this project's cached secrets list.

        The vault owns list-cache invalidation so every writer goes through one path. A
        reader that finds the cached list disagrees with the stored row needs the same door,
        rather than reaching for the cache helper itself.
        """
        await invalidate_cache(project_id=str(project_id))

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
                authorize_delete=_authorize_delete,
            )

        if project_id is not None:
            await invalidate_cache(project_id=str(project_id))
