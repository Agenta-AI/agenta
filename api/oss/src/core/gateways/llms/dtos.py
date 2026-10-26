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
    # How long one streaming attempt may wait for the upstream's response headers before the
    # gateway cancels it and sends the same body again. Vertex sends its headers with the first
    # output, so there this bounds the wait for the first byte. Streaming only: a non-streaming
    # answer arrives whole, so a short limit there would cut long answers that never stalled.
    response_headers_timeout_seconds: Optional[float] = None


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
    # Editable, unlike `deployment_kind`: an endpoint saved without a provider cannot resolve
    # at all, and before this field existed the edit path silently discarded a `provider_key`
    # in the body, so the only way to add one was to delete the endpoint and recreate it.
    # Omitting it preserves the stored value (see `map_llm_endpoint_edit_to_dbe`).
    provider_key: Optional[str] = None
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
    # Google's native `streamGenerateContent`, served only by the built-in Gemini endpoint.
    GEMINI = "gemini"


class LLMCallContext(BaseModel):
    """Routing fields extracted from an LLM request."""

    model: str
    stream: bool = False
    protocol: LLMProtocol = LLMProtocol.CHAT_COMPLETIONS
    # How many earlier attempts of this call stalled (`response_headers_timeout_seconds`). An
    # adapter may vary the retried request, since an upstream stuck on one request can stall
    # again on the identical body.
    stalled_attempts: int = 0


class LLMResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""

    provider_key: Optional[str] = None
    deployment_kind: LLMDeploymentKind
    model: str
    # The endpoint's name (its slug), for the relay's one special case.
    label: Optional[str] = None
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
    # The protocol a harness that knows it should speak on this route instead of the one
    # `provider_key` implies: `gemini` on the built-in Gemini endpoint. A harness that does
    # not know the field keeps the OpenAI-compatible route `provider_key` names.
    protocol: Optional[LLMProtocol] = None
