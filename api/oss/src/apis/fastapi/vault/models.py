"""Request/response schemas for the connection read list and the internal resolve.

These are the API-layer wire shapes for the provider/model/auth feature (design:
``docs/design/agent-workflows/projects/provider-model-auth/design.md``). The connection read
list (:class:`ConnectionView`, reused from the core layer) is non-secret. The resolve
request/response live here; the resolve RESPONSE carries plaintext credentials in ``env`` and is
internal-only (see the router docstring / design Security rule 3).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from oss.src.core.secrets.connections import (
    ConnectionEndpointView,
    ConnectionView,
)


class ConnectionModelRefRequest(BaseModel):
    """The ``ModelRef`` as it arrives on the resolve request (mirrors the SDK ``ModelRef``)."""

    provider: Optional[str] = None
    model: str
    params: Dict[str, Any] = Field(default_factory=dict)
    connection: "ConnectionRequest" = Field(default_factory=lambda: ConnectionRequest())


class ConnectionRequest(BaseModel):
    mode: str = "default"  # "default" | "self_managed" | "agenta"
    slug: Optional[str] = None  # required iff mode == "agenta"


class ResolveConnectionRequest(BaseModel):
    """The resolve request body. ``project_id`` is NOT here: it comes from request context."""

    model: ConnectionModelRefRequest
    harness: str
    backend: Optional[str] = None


class ResolvedConnectionResponse(BaseModel):
    """The resolve response. Carries ``env`` with the plaintext key: internal-only.

    Matches the SDK ``ResolvedConnection`` wire shape. ``env`` is the only secret-bearing channel
    (one provider's vars); ``endpoint`` is non-secret.
    """

    provider: str
    model: str
    deployment: str = "direct"
    credential_mode: str
    env: Dict[str, str] = Field(default_factory=dict)
    endpoint: Optional[ConnectionEndpointView] = None


class ConnectionsListResponse(BaseModel):
    """Envelope for the non-secret connection read list."""

    count: int
    connections: List[ConnectionView]


ConnectionModelRefRequest.model_rebuild()
