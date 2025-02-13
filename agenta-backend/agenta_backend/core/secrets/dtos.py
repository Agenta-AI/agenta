from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

from agenta_backend.core.secrets.enums import SecretKind, ProviderKind
from agenta_backend.core.shared.dtos import (
    IdentifierDTO,
    HeaderDTO,
    LifecycleDTO,
)


class ProviderKeyDTO(BaseModel):
    provider: ProviderKind
    key: str


class SecretDTO(BaseModel):
    kind: SecretKind
    data: ProviderKeyDTO


class CreateSecretDTO(BaseModel):
    header: HeaderDTO
    secret: SecretDTO

    @model_validator(mode="before")
    def ensure_payload_is_not_empty(cls, values):
        if not values.get("header") and not values.get("secret"):
            raise ValueError(
                "Payload cannot be empty. Both 'header' and 'secret' must be provided."
            )
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
    header: Optional[HeaderDTO] = None
    secret: Optional[SecretDTO] = None


class SecretResponseDTO(IdentifierDTO, CreateSecretDTO):
    lifecycle: Optional[LifecycleDTO] = None
