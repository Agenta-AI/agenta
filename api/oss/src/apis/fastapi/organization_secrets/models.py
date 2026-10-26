"""Request and response models of `/organization-secrets/` (M5)."""

from typing import List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    PublicSecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.apis.fastapi.vault.models import SubscriptionTokenRequest
from oss.src.core.secrets.enums import SecretAvailability


class OrganizationSubscriptionTokenRequest(SubscriptionTokenRequest):
    """A `claude setup-token` for an organization subscription login. Its own model, so the
    project route keeps its generated client request shape."""


class OrganizationSecretCreateRequest(CreateSecretDTO):
    """A `provider_key`, `custom_provider` or `subscription_provider` for every project of the organization (or,
    in EE with RBAC, for selected projects). An optional slug; without one the server
    derives `<name>-<12 hex>`. No `management`."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    availability: SecretAvailability = SecretAvailability.ALL_PROJECTS
    project_ids: List[UUID] = Field(default_factory=list)


class OrganizationSecretEditRequest(UpdateSecretDTO):
    """Header and secret; an omitted value keeps the stored one."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class OrganizationSecretProjectsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    availability: SecretAvailability
    project_ids: List[UUID] = Field(default_factory=list)


class PublicOrganizationSecretResponse(PublicSecretResponseDTO):
    """An organization credential without its value or a preview of it."""


class PublicOrganizationSecretsResponse(BaseModel):
    count: int
    secrets: List[PublicOrganizationSecretResponse] = Field(default_factory=list)
