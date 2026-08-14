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


class StandardProviderSettingsDTO(BaseModel):
    key: str


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
    client_secret: str
    issuer_url: str
    scopes: List[str]
    extra: Dict[str, Any] = Field(default_factory=dict)


class SSOProviderDTO(BaseModel):
    provider: SSOProviderSettingsDTO


class WebhookProviderSettingsDTO(BaseModel):
    key: str


class WebhookProviderDTO(BaseModel):
    provider: WebhookProviderSettingsDTO


class CustomSecretSettingsDTO(BaseModel):
    format: CustomSecretFormat
    content: Union[str, Dict[str, Union[str, int, float, bool, None]]]
    # text -> content is a str (stored verbatim); json -> a flat {str: primitive} map.


class CustomSecretDTO(BaseModel):
    secret: CustomSecretSettingsDTO


class OAuthProviderSettingsDTO(BaseModel):
    client_id: str
    client_secret: str
    issuer_url: str
    scopes: List[str]
    extra: Dict[str, Any] = Field(default_factory=dict)


class OAuthProviderDTO(BaseModel):
    provider: OAuthProviderSettingsDTO


class OAuthGrantSettingsDTO(BaseModel):
    server: str
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[int] = None
    scopes: List[str]


class OAuthGrantDTO(BaseModel):
    grant: OAuthGrantSettingsDTO


class SecretDTO(BaseModel):
    kind: SecretKind
    data: Union[
        StandardProviderDTO,
        CustomProviderDTO,
        SSOProviderDTO,
        WebhookProviderDTO,
        CustomSecretDTO,
        OAuthProviderDTO,
        OAuthGrantDTO,
    ]

    @model_validator(mode="before")
    def validate_secret_data_based_on_kind(cls, values: Dict[str, Any]):
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
            if not isinstance(provider, dict) or "key" not in provider:
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
            required_fields = {"client_id", "client_secret", "issuer_url", "scopes"}
            if not required_fields.issubset(provider.keys()):
                raise ValueError(
                    "The provided request secret dto is missing required fields for SSOProviderSettingsDTO"
                )
        elif kind == SecretKind.WEBHOOK_PROVIDER.value:
            if not isinstance(data, dict):
                raise ValueError(
                    "The provided request secret dto is not a valid type for WebhookProviderDTO"
                )
            provider = data.get("provider")
            if not isinstance(provider, dict) or "key" not in provider:
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
                or "content" not in secret
            ):
                raise ValueError(
                    "The provided request secret dto requires data.secret.{format, content} for CustomSecretDTO"
                )
            fmt, content = secret["format"], secret["content"]
            if fmt == CustomSecretFormat.TEXT.value:
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
        elif kind == SecretKind.OAUTH_PROVIDER.value:
            if not isinstance(data, dict):
                raise ValueError(
                    "The provided request secret dto is not a valid type for OAuthProviderDTO"
                )
            provider = data.get("provider")
            if not isinstance(provider, dict):
                raise ValueError(
                    "The provided request secret dto is missing required fields for OAuthProviderSettingsDTO"
                )
            required_fields = {"client_id", "client_secret", "issuer_url", "scopes"}
            if not required_fields.issubset(provider.keys()):
                raise ValueError(
                    "The provided request secret dto is missing required fields for OAuthProviderSettingsDTO"
                )
            # OAuthProviderDTO and SSOProviderDTO share a shape; the kind must decide, not the union.
            values["data"] = OAuthProviderDTO.model_validate(data)
        elif kind == SecretKind.OAUTH_GRANT.value:
            if not isinstance(data, dict):
                raise ValueError(
                    "The provided request secret dto is not a valid type for OAuthGrantDTO"
                )
            grant = data.get("grant")
            if not isinstance(grant, dict):
                raise ValueError(
                    "The provided request secret dto is missing required fields for OAuthGrantSettingsDTO"
                )
            required_fields = {"server", "access_token", "scopes"}
            if not required_fields.issubset(grant.keys()):
                raise ValueError(
                    "The provided request secret dto is missing required fields for OAuthGrantSettingsDTO"
                )
            values["data"] = OAuthGrantDTO.model_validate(data)
        else:
            raise ValueError("The provided kind is not a valid SecretKind enum")

        return values


class CreateSecretDTO(Slug, BaseModel):
    header: Header
    secret: SecretDTO

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


class UpdateSecretDTO(BaseModel):
    header: Optional[Header] = None
    secret: Optional[SecretDTO] = None

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


class SecretResponseDTO(Identifier, Slug, SecretDTO):
    header: Header
    lifecycle: Optional[LegacyLifecycleDTO] = None

    @model_validator(mode="before")
    def build_up_model_keys(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """
        This method builds up model keys for a custom provider secret.

        Args:
            - values (SecretResponseDTO): A dictionary form.

        Returns:
        - Dict[str, Any]: The updated dictionary with the added model keys.

        """
        data = values.get("data")
        kind = values.get("kind")

        if kind == SecretKind.CUSTOM_PROVIDER.value:
            model_keys = [
                f"{data.get('provider_slug')}/{data.get('kind')}/{model.get('slug')}"  # type: ignore
                for model in data.get("models")  # type: ignore
            ]
            values["data"].update({"model_keys": model_keys})

        return values
