from typing import Optional, Union, List, Dict, Any

from pydantic import BaseModel, field_validator, model_validator

from oss.src.core.secrets.enums import (
    SecretKind,
    StandardProviderKind,
    CustomProviderKind,
)
from oss.src.core.shared.dtos import (
    Identifier,
    Header,
    LegacyLifecycleDTO,
)


class StandardProviderSettingsDTO(BaseModel):
    key: str


class StandardProviderDTO(BaseModel):
    kind: StandardProviderKind
    provider: StandardProviderSettingsDTO


class CustomProviderSettingsDTO(BaseModel):
    url: Optional[str] = None
    version: Optional[str] = None
    key: Optional[str] = None
    extras: Optional[dict] = None


class CustomModelSettingsDTO(BaseModel):
    slug: str
    extras: Optional[dict] = None


class CustomProviderDTO(BaseModel):
    kind: CustomProviderKind
    provider: CustomProviderSettingsDTO
    models: List[CustomModelSettingsDTO]

    # fields will be filled at runtime
    provider_slug: Optional[str] = None
    model_keys: Optional[List[str]] = None


class SecretDTO(BaseModel):
    kind: SecretKind
    data: Union[StandardProviderDTO, CustomProviderDTO]

    @model_validator(mode="before")
    def validate_secret_data_based_on_kind(cls, values: Dict[str, Any]):
        kind = values.get("kind")
        data = values.get("data", {})

        if kind == SecretKind.PROVIDER_KEY.value:
            if not isinstance(data, dict):
                raise ValueError(
                    "The provided request secret dto is not a valid type for StandardProviderDTO"
                )
            if not isinstance(data["provider"], dict) or "key" not in data["provider"]:
                raise ValueError(
                    "The provided request secret dto is missing required fields for StandardProviderSettingsDTO"
                )
            if data["kind"] not in StandardProviderKind.__members__.values():
                raise ValueError(
                    "The provided kind in data is not a valid StandardProviderKind enum"
                )

        elif kind == SecretKind.CUSTOM_PROVIDER.value:
            # Fix inconsistent API naming - Users might enter 'togetherai' but the API requires 'together_ai'
            # This ensures compatibility with LiteLLM which requires the provider in "together_ai" format
            if data.get("kind", "") == "togetherai":
                data["kind"] = "together_ai"

            if not isinstance(data, dict):
                raise ValueError(
                    "The provided request secret dto is not a valid type for CustomProviderDTO"
                )
            if data["kind"] not in CustomProviderKind.__members__.values():
                raise ValueError(
                    "The provided kind in data is not a valid CustomProviderKind enum"
                )
        else:
            raise ValueError("The provided kind is not a valid SecretKind enum")

        return values


class CreateSecretDTO(BaseModel):
    header: Header
    secret: SecretDTO

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
            if secret.get("kind") == SecretKind.CUSTOM_PROVIDER.value:
                secret["data"].update({"provider_slug": header["name"]})
        return values

    @field_validator("header", mode="before")
    def ensure_header_exists(cls, value):
        if value is not None:
            if isinstance(value, dict) and not any(value.values()):
                raise ValueError("Header cannot be empty.")
            if isinstance(value, BaseModel) and all(
                v is None for v in value.model_dump().values()
            ):
                raise ValueError("Header cannot contain only None values.")
        return value


class UpdateSecretDTO(BaseModel):
    header: Optional[Header] = None
    secret: Optional[SecretDTO] = None

    @model_validator(mode="before")
    def update_provider_slug_with_header_name(cls, values):
        header = values.get("header")
        secret = values.get("secret")
        if header and isinstance(header, dict) and "name" in header:
            if secret.get("kind") == SecretKind.CUSTOM_PROVIDER.value:
                secret["data"].update({"provider_slug": header["name"]})
        return values


class SecretResponseDTO(Identifier, SecretDTO):
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
