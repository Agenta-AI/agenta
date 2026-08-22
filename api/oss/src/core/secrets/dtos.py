from typing import Optional, Union, List, Dict, Any

from pydantic import BaseModel, Field, model_validator

from oss.src.core.secrets.enums import (
    SecretKind,
    StandardProviderKind,
    CustomProviderKind,
    CustomSecretFormat,
)
from oss.src.core.shared.dtos import (
    Identifier,
    Header,
    Slug,
    LegacyLifecycleDTO,
)
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip


class SecretValueRequiredError(Exception):
    """Raised when an update changes a secret's kind or provider family without a new value.

    Keep-on-omit is identity-local: carrying a stored credential across a kind or provider
    change would silently hand one provider's key to another.
    """

    def __init__(
        self,
        message: str = "Changing a secret's kind or provider requires a new "
        "credential value; the stored value is never carried across identities.",
    ):
        self.message = message
        super().__init__(message)


# The value-bearing fields below are optional at the structural level. Each role-specific
# payload decides whether omission is valid: create requires a value, update uses omission
# to mean "keep stored", and responses may be redacted.


class StandardProviderSettingsDTO(BaseModel):
    key: Optional[str] = None


class CustomModelSettingsDTO(BaseModel):
    slug: str
    extras: Optional[dict] = None


class StandardProviderDTO(BaseModel):
    kind: StandardProviderKind
    provider: StandardProviderSettingsDTO
    # A missing list means "use Agenta's default models"; an empty list is an explicit "none".
    models: Optional[List[CustomModelSettingsDTO]] = None
    # A missing list means "any harness Agenta supports"; a saved list narrows that set.
    harnesses: Optional[List[str]] = None


class CustomProviderSettingsDTO(BaseModel):
    url: Optional[str] = None
    version: Optional[str] = None
    key: Optional[str] = None
    extras: Optional[dict] = None


class CustomProviderDTO(BaseModel):
    kind: CustomProviderKind
    provider: CustomProviderSettingsDTO
    models: List[CustomModelSettingsDTO]
    harnesses: Optional[List[str]] = None

    # fields will be filled at runtime
    provider_slug: Optional[str] = None
    model_keys: Optional[List[str]] = None


class SSOProviderSettingsDTO(BaseModel):
    client_id: str
    client_secret: Optional[str] = None
    issuer_url: str
    scopes: List[str]
    extra: Dict[str, Any] = Field(default_factory=dict)


class SSOProviderDTO(BaseModel):
    provider: SSOProviderSettingsDTO


class WebhookProviderSettingsDTO(BaseModel):
    key: Optional[str] = None


class WebhookProviderDTO(BaseModel):
    provider: WebhookProviderSettingsDTO


class CustomSecretSettingsDTO(BaseModel):
    format: CustomSecretFormat
    content: Optional[Union[str, Dict[str, Union[str, int, float, bool, None]]]] = None
    # text -> content is a str (stored verbatim); json -> a flat {str: primitive} map.


class CustomSecretDTO(BaseModel):
    secret: CustomSecretSettingsDTO


SecretDataDTO = Union[
    StandardProviderDTO,
    CustomProviderDTO,
    SSOProviderDTO,
    WebhookProviderDTO,
    CustomSecretDTO,
]


def _validate_secret_data_based_on_kind(
    values: Dict[str, Any],
    *,
    value_required: bool,
) -> Dict[str, Any]:
    kind = values.get("kind")
    if isinstance(kind, SecretKind):
        kind = kind.value
    data = values.get("data", {})
    if isinstance(data, BaseModel):
        data = data.model_dump()
        values["data"] = data

    standard_provider_kinds = {provider.value for provider in StandardProviderKind}
    custom_provider_kinds = {provider.value for provider in CustomProviderKind}

    if kind == SecretKind.PROVIDER_KEY.value:
        if not isinstance(data, dict):
            raise ValueError(
                "The provided request secret dto is not a valid type for StandardProviderDTO"
            )
        provider = data.get("provider")
        if not isinstance(provider, dict) or (
            value_required and provider.get("key") in (None, "")
        ):
            raise ValueError(
                "The provided request secret dto is missing required fields for StandardProviderSettingsDTO"
            )
        # Accept the legacy provider slug on input, but persist the canonical value.
        if data.get("kind") == StandardProviderKind.MISTRALAI.value:
            data["kind"] = StandardProviderKind.MISTRAL.value
        if data.get("kind") not in standard_provider_kinds:
            raise ValueError(
                "The provided kind in data is not a valid StandardProviderKind enum"
            )
        # Both provider shapes now accept {kind, provider, models}, so the union can no
        # longer tell them apart from the payload alone; the secret kind decides.
        values["data"] = StandardProviderDTO.model_validate(data)

    elif kind == SecretKind.CUSTOM_PROVIDER.value:
        if not isinstance(data, dict):
            raise ValueError(
                "The provided request secret dto is not a valid type for CustomProviderDTO"
            )
        # Fix inconsistent API naming - Users might enter 'togetherai' but the API requires 'together_ai'
        # This ensures compatibility with LiteLLM which requires the provider in "together_ai" format
        if data.get("kind", "") == "togetherai":
            data["kind"] = "together_ai"

        if data.get("kind") not in custom_provider_kinds:
            raise ValueError(
                "The provided kind in data is not a valid CustomProviderKind enum"
            )

        provider_url = (data.get("provider") or {}).get("url")
        if isinstance(provider_url, str) and provider_url:
            try:
                validate_url_format_and_literal_ip(provider_url)
            except ValueError as exc:
                raise ValueError(f"custom_provider.url is invalid: {exc}") from exc

        values["data"] = CustomProviderDTO.model_validate(data)
    elif kind == SecretKind.SSO_PROVIDER.value:
        if not isinstance(data, dict):
            raise ValueError(
                "The provided request secret dto is not a valid type for SSOProviderDTO"
            )
        provider = data.get("provider")
        if not isinstance(provider, dict):
            raise ValueError(
                "The provided request secret dto is missing required fields for SSOProviderSettingsDTO"
            )
        required_fields = {"client_id", "issuer_url", "scopes"}
        # `client_secret` is checked by VALUE, not by presence: a create carrying an
        # explicit null would otherwise store a credential-less SSO record, and a
        # value is optional only on the update path (omission means "keep the stored
        # one") and in redacted responses.
        if not required_fields.issubset(provider.keys()) or (
            value_required and provider.get("client_secret") in (None, "")
        ):
            raise ValueError(
                "The provided request secret dto is missing required fields for SSOProviderSettingsDTO"
            )
    elif kind == SecretKind.WEBHOOK_PROVIDER.value:
        if not isinstance(data, dict):
            raise ValueError(
                "The provided request secret dto is not a valid type for WebhookProviderDTO"
            )
        provider = data.get("provider")
        if not isinstance(provider, dict) or (
            value_required and provider.get("key") in (None, "")
        ):
            raise ValueError(
                "The provided request secret dto is missing required fields for WebhookProviderSettingsDTO"
            )
    elif kind == SecretKind.CUSTOM_SECRET.value:
        if not isinstance(data, dict):
            raise ValueError(
                "The provided request secret dto is not a valid type for CustomSecretDTO"
            )
        secret = data.get("secret")
        if (
            not isinstance(secret, dict)
            or "format" not in secret
            or (value_required and secret.get("content") is None)
        ):
            raise ValueError(
                "The provided request secret dto requires data.secret.{format, content} for CustomSecretDTO"
            )
        fmt, content = secret["format"], secret.get("content")
        if content is None:
            pass  # Value-less shape allowed when VALUE_REQUIRED is off; nothing to type-check.
        elif fmt == CustomSecretFormat.TEXT.value:
            if not isinstance(content, str):
                raise ValueError("A text custom_secret requires a string content")
            # Stored verbatim; do NOT re-serialize a JSON-looking string.
        elif fmt == CustomSecretFormat.JSON.value:
            if not isinstance(content, dict):
                raise ValueError("A json custom_secret requires an object content")
            for v in content.values():
                if isinstance(v, (dict, list)):
                    raise ValueError(
                        "A json custom_secret must be flat: values cannot be objects or arrays"
                    )
        else:
            raise ValueError("A custom_secret format must be 'text' or 'json'")
    else:
        raise ValueError("The provided kind is not a valid SecretKind enum")

    return values


class SecretDTO(BaseModel):
    """Create-time secret payload. Required credential fields must be present."""

    kind: SecretKind
    data: SecretDataDTO

    @model_validator(mode="before")
    @classmethod
    def validate_secret_data_based_on_kind(cls, values: Dict[str, Any]):
        return _validate_secret_data_based_on_kind(values, value_required=True)


class CreateSecretDTO(Slug, BaseModel):
    header: Header
    secret: SecretDTO
    write_only: bool = True
    # Server-controlled: which platform component provisioned and owns this row (see
    # `core/secrets/managed.py`). In-process callers set it; every user-facing route
    # rejects a client-supplied value with HTTP 400.
    managed_by: Optional[str] = None

    @model_validator(mode="before")
    def ensure_header_exists(cls, values):
        # Only a provider_key may arrive header-less: it is named after its provider on create
        # (see `VaultService.create_secret`). Every other kind is addressed by its name.
        secret = values.get("secret")
        kind = (
            secret.get("kind")
            if isinstance(secret, dict)
            else getattr(secret, "kind", None)
        )
        if isinstance(kind, SecretKind):
            kind = kind.value
        if kind == SecretKind.PROVIDER_KEY.value:
            return values

        header = values.get("header")
        if isinstance(header, BaseModel):
            header = header.model_dump()
        if not isinstance(header, dict) or not any(header.values()):
            raise ValueError("Header cannot be empty.")

        return values

    @model_validator(mode="before")
    def ensure_payload_is_not_empty(cls, values):
        if not values.get("header") and not values.get("secret"):
            raise ValueError(
                "Payload cannot be empty. Both 'header' and 'secret' must be provided."
            )
        return values

    @model_validator(mode="before")
    def update_provider_slug_with_header_name(cls, values):
        header = values.get("header")
        secret = values.get("secret")
        if header and isinstance(header, dict) and "name" in header:
            if (
                isinstance(secret, dict)
                and secret.get("kind") == SecretKind.CUSTOM_PROVIDER.value
            ):
                secret["data"].update({"provider_slug": header["name"]})
        return values


class UpdateSecretPayloadDTO(BaseModel):
    """Update-time payload. Omitted credential fields keep their stored values."""

    kind: SecretKind
    data: SecretDataDTO

    @model_validator(mode="before")
    @classmethod
    def validate_secret_data_based_on_kind(cls, values: Dict[str, Any]):
        return _validate_secret_data_based_on_kind(values, value_required=False)


class UpdateSecretDTO(BaseModel):
    header: Optional[Header] = None
    secret: Optional[UpdateSecretPayloadDTO] = None
    # Server-controlled. None keeps the stored marker; a non-empty string sets it and an
    # empty string clears it, both only for in-process callers that pass
    # `allow_managed=True` (`ManagedByIsServerControlledError` otherwise).
    managed_by: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def reject_write_only_updates(cls, values):
        if isinstance(values, dict) and "write_only" in values:
            raise ValueError(
                "write_only is selected when a secret is created and cannot be updated"
            )
        return values

    @model_validator(mode="before")
    def update_provider_slug_with_header_name(cls, values):
        header = values.get("header")
        secret = values.get("secret")
        if header and isinstance(header, dict) and "name" in header:
            if (
                isinstance(secret, dict)
                and secret.get("kind") == SecretKind.CUSTOM_PROVIDER.value
            ):
                secret["data"].update({"provider_slug": header["name"]})
        return values


class SecretValueStatus(BaseModel):
    configured: bool
    preview: Optional[str] = None


class _SecretResponseBaseDTO(Identifier, Slug, BaseModel):
    kind: SecretKind
    data: SecretDataDTO
    header: Header
    lifecycle: Optional[LegacyLifecycleDTO] = None

    write_only: bool = False

    @model_validator(mode="before")
    @classmethod
    def validate_secret_data_based_on_kind(cls, values: Dict[str, Any]):
        return _validate_secret_data_based_on_kind(values, value_required=False)

    @model_validator(mode="after")
    def build_up_model_keys(self):
        if self.kind == SecretKind.CUSTOM_PROVIDER:
            self.data.model_keys = [  # type: ignore[union-attr]
                f"{self.data.provider_slug}/{self.data.kind.value}/{model.slug}"  # type: ignore[union-attr]
                for model in self.data.models  # type: ignore[union-attr]
            ]
        return self


class SecretResponseDTO(_SecretResponseBaseDTO):
    """Trusted internal representation. Credential material remains available."""

    # Read-only: present when a platform component owns the row, absent otherwise (the
    # vault routes exclude None fields). Users can read and use such a row, but not edit
    # or delete it.
    managed_by: Optional[str] = None


class PublicSecretResponseDTO(_SecretResponseBaseDTO):
    """Caller-facing representation after grant-aware value projection."""

    managed_by: Optional[str] = None
    value_status: SecretValueStatus
