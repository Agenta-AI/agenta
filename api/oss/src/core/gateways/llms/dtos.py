"""The LLM plane's DTOs (entities.md §4.3)."""

from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateways.dtos import GatewayEndpointConfig, GatewayEndpointNamespace
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
    Status,
)


class LlmDeploymentKind(str, Enum):
    """How a provider is reached — the wire's `deployment` axis, aligned with
    CustomProviderKind in core/secrets/enums.py (`models.md`: keep both axes)."""

    DIRECT = "direct"
    CUSTOM = "custom"  # OpenAI-compatible third party or self-hosted
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"


class LlmEndpointRoute(BaseModel):
    """The route, mirroring the runner wire's `endpoint` object field for field
    (services/runner/src/protocol.ts): baseUrl for OpenAI-compatible, apiVersion
    for Azure, region for AWS and Vertex, headers for non-secret routing."""

    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class LlmEndpointConfig(GatewayEndpointConfig):
    max_output_tokens: Optional[int] = (
        None  # ceiling (D21); rejected, never clamped (D25)
    )


class LlmEndpointData(BaseModel):
    route: LlmEndpointRoute = Field(default_factory=LlmEndpointRoute)
    model_slugs: List[str] = Field(default_factory=list)  # allowlist; empty refuses all
    config: LlmEndpointConfig = Field(default_factory=LlmEndpointConfig)
    extras: Optional[Dict[str, Any]] = None


class LlmEndpointFlags(BaseModel):
    is_active: bool = True
    # no is_valid: an endpoint does not authenticate; credential health lives
    # with the credential (§2.6)


class LlmEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    provider_key: str
    deployment: LlmDeploymentKind
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)
    status: Optional[Status] = None


class LlmEndpointCreate(Slug, Header, Metadata):
    provider_key: str
    deployment: LlmDeploymentKind
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)


class LlmEndpointEdit(Identifier, Header, Metadata):
    # no provider_key, no deployment: repointing an endpoint at a different
    # provider family is a different endpoint, not an edit (the channels rule)
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)


class LlmEndpointQuery(BaseModel):
    provider_key: Optional[str] = None
    deployment: Optional[LlmDeploymentKind] = None
    slug: Optional[str] = None


class LlmCallContext(BaseModel):
    """What policy needs from the request body — parsed minimally, so the body
    itself can relay byte for byte (`scope-checklist.md`)."""

    model: str
    stream: bool = False


class LlmResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""

    provider_key: str
    deployment: LlmDeploymentKind
    model: str
    #
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    #
    config: LlmEndpointConfig = Field(default_factory=LlmEndpointConfig)
