"""LLM gateway DTOs."""

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
    """How an upstream model deployment is reached."""

    DIRECT = "direct"
    CUSTOM = "custom"  # OpenAI-compatible third party or self-hosted
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"
    MOCK = "mock"  # In-process test deployment.


class LLMEndpointRoute(GatewayEndpointRoute):
    """Provider-specific route fields."""

    api_version: Optional[str] = None
    region: Optional[str] = None
    extras: Optional[Dict[str, Any]] = None
    """Additional non-secret route fields."""


# The LLM plane's name for the shared filter. Same shape, same storage.
LLMModelFilter = GatewayEndpointFilter


class LLMEndpointSettings(GatewayEndpointSettings):
    max_output_tokens: Optional[int] = None


class LLMEndpointData(BaseModel):
    route: LLMEndpointRoute = Field(default_factory=LLMEndpointRoute)
    models: LLMModelFilter = Field(default_factory=LLMModelFilter)
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)


class LLMEndpointFlags(BaseModel):
    is_active: bool = True


class LLMEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    # Optional for self-hosted compatible endpoints.
    provider_key: Optional[str] = None
    deployment_kind: LLMDeploymentKind
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)
    status: Optional[Status] = None


class LLMEndpointCreate(Slug, Header, Metadata):
    provider_key: Optional[str] = None
    deployment_kind: LLMDeploymentKind
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointEdit(Identifier, Header, Metadata):
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointQuery(BaseModel):
    provider_key: Optional[str] = None
    deployment_kind: Optional[LLMDeploymentKind] = None
    slug: Optional[str] = None


class LLMProtocol(str, Enum):
    """LLM protocol used by the request."""

    CHAT_COMPLETIONS = "chat_completions"
    RESPONSES = "responses"
    MESSAGES = "messages"


class LLMCallContext(BaseModel):
    """Routing fields extracted from an LLM request."""

    model: str
    stream: bool = False
    protocol: LLMProtocol = LLMProtocol.CHAT_COMPLETIONS


class LLMResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""

    provider_key: Optional[str] = None
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


class LLMGatewayConnectionResolution(BaseModel):
    """Non-secret result of resolving one agent model connection.

    The API core chooses and validates the endpoint while it has vault access.  The service
    process receives this route metadata only; provider-key material never crosses that
    boundary.
    """

    namespace: GatewayEndpointNamespace
    name: str
    provider_key: str
    deployment_kind: LLMDeploymentKind
    model: str
