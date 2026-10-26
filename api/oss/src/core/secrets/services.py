from typing import Any, Callable, List, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from pydantic import ValidationError

from oss.src.utils.env import env
from oss.src.core.access.context import clear_request_memo, get_request_memo
from oss.src.utils.caching import (
    get_cache,
    invalidate_cache,
    invalidate_cache_entries,
    set_cache,
)
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.utils.logging import get_module_logger
from oss.src.core.secrets.enums import (
    STANDARD_PROVIDER_DISPLAY_NAMES,
    SUBSCRIPTION_PROVIDER_DISPLAY_NAMES,
    ORGANIZATION_SECRET_KINDS,
    LLMCustomProviderKind,
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
    StandardProviderKind,
    SubscriptionProviderKind,
)
from oss.src.core.events.types import EventType
from oss.src.core.events.utils import _build_event, _safe_publish
from oss.src.core.gateways.dtos import MIN_SCANNED_CREDENTIAL_LENGTH
from oss.src.core.gateways.llms.registrar import custom_provider_deployment_kind
from oss.src.core.gateways.llms.types import LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS
from oss.src.core.secrets.interfaces import (
    LLMEndpointRegistrarInterface,
    ProjectLimitsInterface,
    SecretsDAOInterface,
)
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.redaction import (
    CREDENTIAL_EXTRAS_KEYS,
    PRIMARY_CREDENTIAL_FIELDS,
    SECONDARY_CREDENTIAL_FIELDS,
)
from oss.src.core.secrets.types import (
    OrganizationSecretKindNotShareable,
    OrganizationSecretNotFound,
    OrganizationSecretNotServed,
    OrganizationSecretValueNotScannable,
    OrganizationSecretValueTooShort,
    ProjectLimitNotAllowed,
    ServerOwnedFieldNotWritable,
    SubscriptionProviderConflict,
)
from oss.src.core.secrets.scopes import (
    available_organization_secrets,
    is_llm_provider_family,
    organization_matches,
)
from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    CreateSecretDTO,
    SecretOwner,
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


log = get_module_logger(__name__)

# One cache entry per project: its rows, its row's organization, and the shareable
# organization rows available to it. Keyed on the FULL project id (`_pack` keeps only 12
# characters of the project slot), in the project slot so project-wide invalidation clears
# it, from old pods too.
_EFFECTIVE_NAMESPACE = "effective_secrets"

# Printable ASCII without the characters JSON encoders escape (quote, backslash, and the
# HTML-safe <, >, &) and without the space: what an organization credential that goes into
# a header may hold. `/` stays allowed; its escaped spelling is scanned too.
_SHAREABLE_CREDENTIAL_CHARACTERS = frozenset(
    chr(code) for code in range(0x21, 0x7F) if chr(code) not in '"\\<>&'
)
# Credential extras that are documents, not header values.
_STRUCTURED_CREDENTIAL_KEYS = frozenset({"vertex_ai_credentials"})
_EFFECTIVE_MEMO = "secrets_effective"


def _owner_of(
    *, project_id: Optional[UUID], organization_id: Optional[UUID]
) -> SecretOwner:
    """The owner the public (project_id, organization_id) pair names: exactly one."""
    if bool(project_id) == bool(organization_id):
        raise ValueError(
            "Exactly one of project_id or organization_id must be provided."
        )
    if project_id:
        return SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
    return SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=organization_id)


_BLANK_CREDENTIAL_VALUE_MESSAGE = (
    "Credential values cannot be blank. Omit an unchanged credential field or provide a new "
    "value."
)


def next_provider_key_name(
    *,
    kind: StandardProviderKind,
    taken_names: set[str],
    owner_label: Optional[str] = None,
) -> str:
    """The first free display name for a new connection of ``kind``.

    The first connection of a provider family takes the plain display name ("OpenAI"), later
    ones get a suffix ("OpenAI 2", "OpenAI 3"). With an `owner_label` the name carries the
    owner ("OpenAI (Organization)", then "OpenAI (Organization) 2"). The name is display
    only; the slug is identity.
    """
    title = STANDARD_PROVIDER_DISPLAY_NAMES.get(kind, kind.value)
    if owner_label:
        title = f"{title} ({owner_label})"

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

    # Secondary secrets sit beside the primary in the same container (Slack's
    # signing_secret, Telegram's server-minted webhook_secret). They are neither
    # the primary nor extras, so without this a token-only rotation would drop
    # them and break inbound verification. Keep an omitted one from the stored
    # record, the same rule as the primary.
    secondary_container_name, secondary_fields = SECONDARY_CREDENTIAL_FIELDS.get(
        kind, (None, ())
    )
    if secondary_container_name is not None:
        update_container = getattr(update_data, secondary_container_name, None)
        stored_container = getattr(stored_data, secondary_container_name, None)
        if update_container is not None and stored_container is not None:
            for secondary in secondary_fields:
                if not hasattr(update_container, secondary):
                    continue
                current_value = getattr(update_container, secondary)
                # A blank secondary is invalid, the same rule as the primary:
                # an empty webhook_secret would break inbound verification.
                if current_value == "":
                    raise SecretValueRequiredError(
                        message=_BLANK_CREDENTIAL_VALUE_MESSAGE
                    )
                if current_value is None:
                    stored_value = getattr(stored_container, secondary, None)
                    if stored_value is not None:
                        setattr(update_container, secondary, stored_value)

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
    wipe them. A field the payload set is a choice and is left alone: an empty list ("offer
    nothing"), and a subscription list normalized to None ("follow the defaults").
    """
    for field in ("models", "harnesses"):
        if not hasattr(update_data, field) or field in update_data.model_fields_set:
            continue

        stored_value = getattr(stored_data, field, None)

        if stored_value is not None:
            setattr(update_data, field, stored_value)


class VaultService:
    def __init__(
        self,
        secrets_dao: SecretsDAOInterface,
        *,
        llm_endpoint_registrar: Optional[LLMEndpointRegistrarInterface] = None,
        # Whether an organization may limit a credential to selected projects. None
        # refuses every limit (workers and other roots that manage no credential).
        project_limits: Optional[ProjectLimitsInterface] = None,
    ):
        self.secrets_dao = secrets_dao
        self.llm_endpoint_registrar = llm_endpoint_registrar
        self.project_limits = project_limits
        self._data_encryption_key = env.agenta.crypt_key

    async def create_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
        user_id: UUID | None = None,
    ):
        return await self._create_secret(
            project_id=project_id,
            organization_id=organization_id,
            create_secret_dto=create_secret_dto,
            management=None,
            user_id=user_id,
        )

    async def create_managed_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
        management: SecretManagementDTO,
        user_id: UUID | None = None,
    ):
        return await self._create_secret(
            project_id=project_id,
            organization_id=organization_id,
            create_secret_dto=create_secret_dto,
            management=management,
            user_id=user_id,
        )

    async def _create_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
        management: SecretManagementDTO | None,
        user_id: UUID | None = None,
    ):
        reject_server_owned_fields(secret=create_secret_dto.secret)
        owner = _owner_of(project_id=project_id, organization_id=organization_id)

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
                owner=owner,
                create_secret_dto=create_secret_dto,
            )

        if create_secret_dto.secret.kind == SecretKind.SUBSCRIPTION_PROVIDER:
            await self._name_and_slug_subscription_provider(
                owner=owner,
                create_secret_dto=create_secret_dto,
            )

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.create(
                owner=owner,
                create_secret_dto=create_secret_dto,
                management=management,
            )

        if project_id is not None:
            await self._invalidate_project(project_id)

        await self._register_llm_endpoint(
            project_id=project_id,
            user_id=user_id,
            secret_dto=secret_dto,
        )

        return secret_dto

    async def _register_llm_endpoint(
        self,
        *,
        project_id: UUID | None,
        user_id: UUID | None,
        secret_dto: Optional[SecretResponseDTO],
    ) -> None:
        """Keep the LLM gateway's endpoint for this connection in step with the vault.

        Only a custom provider names an endpoint. A failure here is logged, never raised:
        the credential is already stored, and a gateway problem must not make the vault
        refuse writes.
        """
        if (
            self.llm_endpoint_registrar is None
            or project_id is None
            or secret_dto is None
            or secret_dto.kind != SecretKind.CUSTOM_PROVIDER
        ):
            return

        try:
            await self.llm_endpoint_registrar.register(
                project_id=project_id,
                user_id=user_id,
                secret=secret_dto,
            )
        except Exception as exception:  # noqa: BLE001 - see the docstring.
            log.warning(
                "Could not register the LLM endpoint for a custom provider secret.",
                secret_id=str(secret_dto.id),
                exception=repr(exception),
            )

    async def _deregister_llm_endpoint(
        self,
        *,
        project_id: UUID | None,
        secret_dto: Optional[SecretResponseDTO],
    ) -> None:
        if (
            self.llm_endpoint_registrar is None
            or project_id is None
            or secret_dto is None
            or secret_dto.kind != SecretKind.CUSTOM_PROVIDER
        ):
            return

        try:
            await self.llm_endpoint_registrar.deregister(
                project_id=project_id,
                secret=secret_dto,
            )
        except Exception as exception:  # noqa: BLE001 - see `_register_llm_endpoint`.
            log.warning(
                "Could not deregister the LLM endpoint for a custom provider secret.",
                secret_id=str(secret_dto.id),
                exception=repr(exception),
            )

    async def _name_and_slug_provider_key(
        self,
        *,
        owner: SecretOwner,
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
                secrets_dtos = await self.secrets_dao.list(owner=owner)

            header.name = next_provider_key_name(
                kind=create_secret_dto.secret.data.kind,
                # An organization connection's default name says it is the organization's.
                owner_label=(
                    "Organization" if owner.kind == SecretOwnerKind.ORGANIZATION else None
                ),
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
        owner: SecretOwner,
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
            secrets_dtos = await self.secrets_dao.list(owner=owner)

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

        # This is the storage identity, not the editable display identity. Keeping it canonical
        # lets the database's (project_id, slug) unique index serialize concurrent creates.
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
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
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
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
            )

    async def list_secrets(
        self,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        """The project's own rows (project_id), or an organization's rows of any kind
        (organization_id, uncached, EE SSO).

        A project read is the `effective_secrets` entry's project rows: the same one cache
        read, filled by the same one statement, as before M5. It never carries
        organization rows, so every plaintext reader sees project rows only."""
        if project_id is not None:
            entry = await self._effective_entry(project_id=project_id)
            return list(entry.secrets)

        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            return await self.secrets_dao.list(
                owner=_owner_of(project_id=project_id, organization_id=organization_id)
            )

    # -- the effective set (M5) ---------------------------------------------------

    async def _effective_entry(self, *, project_id: UUID) -> CachedEffectiveSecrets:
        """The project's one cache entry, read through today's `get_cache` path.

        Warm: one GET. Cold: the lock path and ONE `load_effective` statement. The entry
        stays in the request memo for the rest of the request. A cached value whose
        project id differs is a miss."""
        memo = get_request_memo()
        memo_key = (_EFFECTIVE_MEMO, project_id)
        if memo is not None and memo_key in memo:
            return memo[memo_key]

        cache_key = {"p": str(project_id)}
        entry = await get_cache(
            namespace=_EFFECTIVE_NAMESPACE,
            project_id=str(project_id),
            key=cache_key,
            model=CachedEffectiveSecrets,
        )
        if entry is not None and entry.project_id != project_id:
            log.warning(
                "[secrets] effective entry of another project ignored",
                project_id=str(project_id),
                entry_project_id=str(entry.project_id),
            )
            entry = None

        if entry is None:
            with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
                entry = await self.secrets_dao.load_effective(project_id=project_id)
            await set_cache(
                namespace=_EFFECTIVE_NAMESPACE,
                project_id=str(project_id),
                key=cache_key,
                value=entry,
            )

        if memo is not None:
            memo[memo_key] = entry
        return entry

    def _organization_rows(
        self, *, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]
    ) -> List[SecretResponseDTO]:
        if not organization_matches(entry=entry, organization_id=organization_id):
            if entry.organization and entry.organization_id is not None:
                log.warning(
                    "[secrets] organization mismatch",
                    project_id=str(entry.project_id),
                    project_organization_id=str(entry.organization_id),
                    request_organization_id=str(organization_id),
                )
            return []
        return available_organization_secrets(
            entry=entry, organization_id=organization_id
        )

    async def get_organization_connection(
        self, *, organization_id: UUID, project_id: UUID, slug: str
    ) -> Optional[SecretResponseDTO]:
        """The organization row an agent of this project named by scope `organization`
        and `slug`, when it is available to the project; else None. Never a project row.
        In-process readers only (the LLM gateway); never an HTTP response."""
        entry = await self._effective_entry(project_id=project_id)
        return next(
            (
                secret
                for secret in self._organization_rows(
                    entry=entry, organization_id=organization_id
                )
                if secret.slug == slug
            ),
            None,
        )

    async def get_connection_secret_by_id(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        secret_id: UUID,
        owner_kind: SecretOwnerKind,
    ) -> Optional[SecretResponseDTO]:
        """A project reference: today's project-scoped read by id. An organization
        reference: only an organization row available to the project. Never a
        substitute."""
        if owner_kind == SecretOwnerKind.PROJECT:
            return await self.get_secret_by_id(secret_id, project_id=project_id)
        if owner_kind != SecretOwnerKind.ORGANIZATION:
            return None
        entry = await self._effective_entry(project_id=project_id)
        return next(
            (
                secret
                for secret in self._organization_rows(
                    entry=entry, organization_id=organization_id
                )
                if secret.id == secret_id
            ),
            None,
        )

    async def list_project_and_organization_secrets(
        self, *, organization_id: UUID, project_id: UUID
    ) -> Tuple[List[SecretResponseDTO], List[SecretResponseDTO]]:
        """The project's rows and the organization rows its agents may name, from ONE
        entry read (`GET /secrets/?include_organization=true`)."""
        entry = await self._effective_entry(project_id=project_id)
        return list(entry.secrets), self._organization_rows(
            entry=entry, organization_id=organization_id
        )

    async def _invalidate_project(self, project_id: UUID) -> None:
        """Every cache entry of the project (old pods' namespaces included), then the
        request memo, so a later read in this request sees the write."""
        await invalidate_cache(project_id=str(project_id))
        clear_request_memo()

    async def _invalidate_organization(self, *, organization_id: UUID) -> List[UUID]:
        """After an organization-credential write commits: the `effective_secrets` entry
        of each project of the organization (exact keys, batched), then the memo. A
        failure is logged and never fails the writer. Returns the projects read."""
        project_ids: List[UUID] = []
        try:
            project_ids = await self.secrets_dao.list_organization_project_ids(
                organization_id=organization_id
            )
        except Exception:  # noqa: BLE001 - see the docstring
            log.warning(
                "[secrets] cache invalidation failed",
                organization_id=str(organization_id),
            )
            clear_request_memo()
            return project_ids
        try:
            await invalidate_cache_entries(
                [
                    {
                        "namespace": _EFFECTIVE_NAMESPACE,
                        "project_id": str(project_id),
                        "key": {"p": str(project_id)},
                    }
                    for project_id in project_ids
                ]
            )
        except Exception:  # noqa: BLE001 - see the docstring
            log.warning(
                "[secrets] cache invalidation failed",
                organization_id=str(organization_id),
            )
        finally:
            clear_request_memo()
        return project_ids

    async def update_secret(
        self,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        user_id: UUID | None = None,
    ):
        reject_server_owned_fields(secret=update_secret_dto.secret)

        # The row as it was, captured under the DAO's write lock the way `delete_secret`
        # captures it: an update may change a secret's kind, and only the previous kind
        # says whether an endpoint was registered for it.
        replaced: list[SecretResponseDTO] = []

        def resolve_update(
            stored_secret_dto: SecretResponseDTO,
            requested_update: UpdateSecretDTO,
        ) -> UpdateSecretDTO:
            resolved = _resolve_update(stored_secret_dto, requested_update)
            replaced.append(stored_secret_dto)
            return resolved

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
                user_id=user_id,
                resolve_update=resolve_update,
            )

        if project_id is not None:
            await self._invalidate_project(project_id)

        # An update that moves a row off `custom_provider` leaves the endpoint registered
        # for it behind, because registration returns early for every other kind and
        # nothing deregistered the old one. The endpoint then names a secret that is no
        # longer a custom provider, and no later write reaches it (CR4).
        #
        # Deregistered before the new registration runs, so a row that arrives at the same
        # slug is the one that survives.
        for previous in replaced:
            if previous.kind == SecretKind.CUSTOM_PROVIDER and (
                secret_dto is None or secret_dto.kind != SecretKind.CUSTOM_PROVIDER
            ):
                await self._deregister_llm_endpoint(
                    project_id=project_id,
                    secret_dto=previous,
                )

        # The row the DAO returns already carries the slug and id the endpoint is keyed on,
        # so registration needs no second read.
        await self._register_llm_endpoint(
            project_id=project_id,
            user_id=user_id,
            secret_dto=secret_dto,
        )

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
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
                user_id=user_id,
                resolve_update=resolve,
            )

        if changed and project_id is not None:
            await self._invalidate_project(project_id)
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
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
                resolve_update=_resolve_managed_update(manager),
            )

        if project_id is not None:
            await self._invalidate_project(project_id)

        # Keep the gateway endpoint in step, as `update_secret` does: a model the manager
        # re-pointed must reach the endpoint's allowlist too.
        await self._register_llm_endpoint(
            project_id=project_id,
            user_id=None,
            secret_dto=secret_dto,
        )
        return secret_dto

    async def delete_managed_secret(
        self,
        *,
        secret_id: UUID,
        manager: SecretManager,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> None:
        """Delete a managed row on behalf of the manager that owns it, for a manager that
        retires what it seeded. Refuses any row another manager owns, and any unmanaged
        row."""
        deleted: list[SecretResponseDTO] = []

        def authorize_delete(stored_secret_dto: SecretResponseDTO) -> None:
            management = stored_secret_dto.management
            if management is None or management.manager != manager:
                raise ManagedSecretReadOnlyError()
            deleted.append(stored_secret_dto)

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            await self.secrets_dao.delete(
                secret_id=secret_id,
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
                authorize_delete=authorize_delete,
            )

        if project_id is not None:
            await self._invalidate_project(project_id)

        for stored_secret_dto in deleted:
            await self._deregister_llm_endpoint(
                project_id=project_id,
                secret_dto=stored_secret_dto,
            )

    async def invalidate_secrets_cache(self, project_id: UUID) -> None:
        """Drop this project's cached secrets list.

        The vault owns list-cache invalidation so every writer goes through one path. A
        reader that finds the cached list disagrees with the stored row needs the same door,
        rather than reaching for the cache helper itself.
        """
        await self._invalidate_project(project_id)

    async def delete_secret(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> None:
        # The DAO hands the row to `authorize_delete` under its write lock; capturing it
        # there is what tells us which endpoint slug to drop, without a second read.
        deleted: list[SecretResponseDTO] = []

        def authorize_delete(stored_secret_dto: SecretResponseDTO) -> None:
            _authorize_delete(stored_secret_dto)
            deleted.append(stored_secret_dto)

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            await self.secrets_dao.delete(
                secret_id=secret_id,
                owner=_owner_of(project_id=project_id, organization_id=organization_id),
                authorize_delete=authorize_delete,
            )

        if project_id is not None:
            await self._invalidate_project(project_id)

        for stored_secret_dto in deleted:
            await self._deregister_llm_endpoint(
                project_id=project_id,
                secret_dto=stored_secret_dto,
            )

    # -- organization credentials (M5) --------------------------------------------

    def _check_organization_secret(self, *, secret: Any) -> None:
        """The product rules of a shareable credential, on the payload as it will be
        stored: a shareable kind, an LLM family for a key, a deployment the gateway
        serves, and values long enough for the gateway's echo scan.

        Normalizes the credential values in place first (surrounding whitespace removed),
        so the minimum applies to the value the gateway will send and scan."""
        kind = secret.kind
        if kind not in ORGANIZATION_SECRET_KINDS:
            raise OrganizationSecretKindNotShareable(kind=str(kind.value))
        if kind == SecretKind.PROVIDER_KEY and not is_llm_provider_family(secret.data):
            raise OrganizationSecretKindNotShareable(kind=str(kind.value))
        if kind == SecretKind.CUSTOM_PROVIDER:
            deployment = custom_provider_deployment_kind(
                LLMCustomProviderKind(_provider_family(secret.data))
            )
            if deployment not in LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS:
                raise OrganizationSecretNotServed(deployment_kind=deployment.value)

        provider = getattr(secret.data, "provider", None)
        if provider is None:
            return
        values = []
        scanned_text = []
        key = getattr(provider, "key", None)
        if isinstance(key, str):
            provider.key = key.strip()
            values.append(provider.key)
            scanned_text.append(("key", provider.key))
        extras = getattr(provider, "extras", None)
        if isinstance(extras, dict):
            for extras_key in CREDENTIAL_EXTRAS_KEYS:
                value = extras.get(extras_key)
                if value is None:
                    continue
                if not isinstance(value, str):
                    # A number or a structure would be sent as its text form, which the
                    # rule below never measured: refuse every non-text credential value.
                    raise OrganizationSecretValueTooShort(
                        min_length=MIN_SCANNED_CREDENTIAL_LENGTH
                    )
                extras[extras_key] = value.strip()
                values.append(extras[extras_key])
                scanned_text.append((extras_key, extras[extras_key]))
        for value in values:
            if len(value) < MIN_SCANNED_CREDENTIAL_LENGTH:
                raise OrganizationSecretValueTooShort(
                    min_length=MIN_SCANNED_CREDENTIAL_LENGTH
                )
        # A value the gateway injects into a header is limited to characters no JSON
        # encoder escapes, so the echo scan's spellings cover every way an upstream can
        # write it back. A structured document (a Vertex service-account JSON) is not sent
        # as a header and keeps its own characters.
        for name, value in scanned_text:
            if name not in _STRUCTURED_CREDENTIAL_KEYS and any(
                character not in _SHAREABLE_CREDENTIAL_CHARACTERS for character in value
            ):
                raise OrganizationSecretValueNotScannable()

    async def _check_project_limit(
        self, *, organization_id: UUID, availability: SecretAvailability
    ) -> None:
        if availability != SecretAvailability.SELECTED_PROJECTS:
            return
        if self.project_limits is None or not (
            await self.project_limits.allows_selected_projects(
                organization_id=organization_id
            )
        ):
            raise ProjectLimitNotAllowed()

    async def _organization_written(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        kind: SecretKind,
        availability: SecretAvailability,
        selected_count: Optional[int],
        action: str,
        user_id: Optional[UUID],
    ) -> None:
        """After the commit: invalidate every project entry of the organization, then
        publish one audit event (ids and kinds only). The event is published even when
        the cache invalidation fails; it needs only the organization's project list, which
        is also the event's home (the event store is keyed by project)."""
        project_ids = await self._invalidate_organization(
            organization_id=organization_id
        )
        if not project_ids:
            log.warning(
                "[secrets] organization credential event not published",
                organization_id=str(organization_id),
                reason="no project to record it on",
            )
            return
        attributes = {
            "organization_id": str(organization_id),
            "secret_id": str(secret_id),
            "kind": kind.value,
            "action": action,
            "availability": availability.value,
            "project_count": (
                selected_count or 0
                if availability == SecretAvailability.SELECTED_PROJECTS
                else len(project_ids)
            ),
            "user_id": str(user_id) if user_id else None,
        }
        try:
            await _safe_publish(
                organization_id=organization_id,
                # The event store is keyed by project; the organization's event rides
                # on its first project (the default one first), read for invalidation.
                project_id=project_ids[0],
                event=_build_event(
                    event_type=EventType.ORGANIZATION_SECRETS_CHANGED,
                    attributes={k: v for k, v in attributes.items() if v is not None},
                ),
            )
        except Exception:  # noqa: BLE001 - audit must never fail the writer
            log.warning(
                "[secrets] organization credential event not published",
                organization_id=str(organization_id),
            )

    async def list_organization_secrets(
        self, *, organization_id: UUID
    ) -> List[SecretResponseDTO]:
        """Inheritable organization rows, read from Postgres (management route)."""
        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            return await self.secrets_dao.list_organization_secrets(
                organization_id=organization_id
            )

    async def fetch_organization_secret(
        self, *, organization_id: UUID, secret_id: UUID
    ) -> Optional[SecretResponseDTO]:
        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            return await self.secrets_dao.fetch_organization_secret(
                organization_id=organization_id, secret_id=secret_id
            )

    async def create_organization_secret(
        self,
        *,
        organization_id: UUID,
        create_secret_dto: CreateSecretDTO,
        user_id: Optional[UUID],
        availability: SecretAvailability = SecretAvailability.ALL_PROJECTS,
        project_ids: Sequence[UUID] = (),
    ) -> SecretResponseDTO:
        reject_server_owned_fields(secret=create_secret_dto.secret)
        self._check_organization_secret(secret=create_secret_dto.secret)
        await self._check_project_limit(
            organization_id=organization_id, availability=availability
        )
        # An organization credential is never readable back, whatever the caller asked.
        create_secret_dto.write_only = True

        if create_secret_dto.secret.kind == SecretKind.PROVIDER_KEY:
            await self._name_and_slug_provider_key(
                owner=SecretOwner(
                    kind=SecretOwnerKind.ORGANIZATION, id=organization_id
                ),
                create_secret_dto=create_secret_dto,
            )
        elif not create_secret_dto.slug and create_secret_dto.header.name:
            create_secret_dto.slug = get_slug_from_name_and_id(
                create_secret_dto.header.name,
                uuid4(),
            )

        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            secret_dto = await self.secrets_dao.create_organization_secret(
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
                availability=availability,
                project_ids=list(project_ids),
                user_id=user_id,
            )

        await self._organization_written(
            organization_id=organization_id,
            secret_id=secret_dto.id,
            kind=secret_dto.kind,
            availability=secret_dto.availability or SecretAvailability.ALL_PROJECTS,
            selected_count=len(secret_dto.selected_project_ids or []),
            action="created",
            user_id=user_id,
        )
        return secret_dto

    async def update_organization_secret(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID],
    ) -> Optional[SecretResponseDTO]:
        reject_server_owned_fields(secret=update_secret_dto.secret)

        def resolve_update(
            stored_secret_dto: SecretResponseDTO,
            requested_update: UpdateSecretDTO,
        ) -> UpdateSecretDTO:
            # Keep-on-omit under the row lock, then the rules on the merged payload.
            merged = _merge_update(stored_secret_dto, requested_update)
            if merged.secret is not None:
                self._check_organization_secret(secret=merged.secret)
            return merged

        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            secret_dto = await self.secrets_dao.update_organization_secret(
                organization_id=organization_id,
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                user_id=user_id,
                resolve_update=resolve_update,
            )

        if secret_dto is not None:
            await self._organization_written(
                organization_id=organization_id,
                secret_id=secret_id,
                kind=secret_dto.kind,
                availability=secret_dto.availability or SecretAvailability.ALL_PROJECTS,
                selected_count=len(secret_dto.selected_project_ids or []),
                action="updated",
                user_id=user_id,
            )
        return secret_dto

    async def delete_organization_secret(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> bool:
        deleted = await self.secrets_dao.delete_organization_secret(
            organization_id=organization_id, secret_id=secret_id
        )
        if deleted is not None:
            await self._organization_written(
                organization_id=organization_id,
                secret_id=secret_id,
                kind=deleted.kind,
                availability=deleted.availability,
                selected_count=deleted.selected_count,
                action="deleted",
                user_id=user_id,
            )
        return deleted is not None

    async def set_organization_secret_availability(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> Optional[SecretResponseDTO]:
        try:
            await self._check_project_limit(
                organization_id=organization_id, availability=availability
            )
        except ProjectLimitNotAllowed:
            # An id that names no credential of this organization (an SSO row, another
            # organization's row, a missing one) answers not found, as on every other
            # organization route. Read only on this refusal path.
            if (
                await self.fetch_organization_secret(
                    organization_id=organization_id, secret_id=secret_id
                )
                is None
            ):
                raise OrganizationSecretNotFound() from None
            raise
        with set_data_encryption_key(data_encryption_key=self._data_encryption_key):
            secret_dto = await self.secrets_dao.set_organization_secret_availability(
                organization_id=organization_id,
                secret_id=secret_id,
                availability=availability,
                project_ids=list(project_ids),
                user_id=user_id,
            )
        if secret_dto is not None:
            await self._organization_written(
                organization_id=organization_id,
                secret_id=secret_id,
                kind=secret_dto.kind,
                availability=secret_dto.availability or SecretAvailability.ALL_PROJECTS,
                selected_count=len(secret_dto.selected_project_ids or []),
                action="availability_changed",
                user_id=user_id,
            )
        return secret_dto
