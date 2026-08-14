"""The LLM plane's DTOs (entities.md §4.3)."""

from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateways.dtos import (
    GatewayEndpointFilter,
    GatewayEndpointNamespace,
    GatewayEndpointRoute,
    GatewayEndpointSettings,
)
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
    Status,
)


class LLMDeploymentKind(str, Enum):
    """How a provider is reached — the wire's `deployment_kind` axis, aligned with
    CustomProviderKind in core/secrets/enums.py (`models.md`: keep both axes)."""

    DIRECT = "direct"
    CUSTOM = "custom"  # OpenAI-compatible third party or self-hosted
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"


class LLMEndpointRoute(GatewayEndpointRoute):
    """The shared route plus what only a provider deployment needs, mirroring the runner
    wire's `endpoint` object (services/runner/src/protocol.ts): apiVersion for Azure,
    region for AWS and Vertex. Which fields matter is decided by `deployment_kind` — an
    `api_version` on Bedrock is ignored, not an error."""

    api_version: Optional[str] = None
    region: Optional[str] = None
    extras: Optional[Dict[str, Any]] = None
    """Non-secret addressing a deployment needs and no named field carries —
    `vertex_project`, `aws_bedrock_runtime_endpoint`, `aws_role_name`. Same rule as
    `headers`: addressing, never secret material, which stays in the secret's own
    `extras` and outranks this on collision (§2.4)."""


# The LLM plane's name for the shared filter. Same shape, same storage.
LLMModelFilter = GatewayEndpointFilter


class LLMEndpointSettings(GatewayEndpointSettings):
    max_output_tokens: Optional[int] = (
        None  # ceiling (D21); rejected, never clamped (D25)
    )


class LLMEndpointData(BaseModel):
    route: LLMEndpointRoute = Field(default_factory=LLMEndpointRoute)
    models: LLMModelFilter = Field(default_factory=LLMModelFilter)
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)


class LLMEndpointFlags(BaseModel):
    is_active: bool = True
    # no is_valid: an endpoint does not authenticate; secret health lives
    # with the secret (§2.6)


class LLMEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    provider_key: str
    deployment_kind: LLMDeploymentKind
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)
    status: Optional[Status] = None


class LLMEndpointCreate(Slug, Header, Metadata):
    provider_key: str
    deployment_kind: LLMDeploymentKind
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointEdit(Identifier, Header, Metadata):
    # no provider_key, no deployment_kind: repointing an endpoint at a different
    # provider family is a different endpoint, not an edit (the channels rule)
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointQuery(BaseModel):
    provider_key: Optional[str] = None
    deployment_kind: Optional[LLMDeploymentKind] = None
    slug: Optional[str] = None


class LLMCallContext(BaseModel):
    """What policy needs from the request body — parsed minimally, so the body
    itself can relay byte for byte (`scope-checklist.md`)."""

    model: str
    stream: bool = False


class LLMResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""

    provider_key: str
    deployment_kind: LLMDeploymentKind
    model: str
    #
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    extras: Optional[Dict[str, Any]] = None
    #
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)
