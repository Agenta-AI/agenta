"""MCP gateway management wire models.

The house triple, matching `triggers/models.py`, plus the connect shapes.

"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
)
from oss.src.core.gateways.mcps.probe import MCPServerProbeResult
from oss.src.core.shared.dtos import Windowing


class MCPEndpointCreateRequest(BaseModel):
    endpoint: MCPEndpointCreate


class MCPEndpointEditRequest(BaseModel):
    endpoint: MCPEndpointEdit


class MCPEndpointQueryRequest(BaseModel):
    endpoint: Optional[MCPEndpointQuery] = None
    windowing: Optional[Windowing] = None


class MCPEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[MCPEndpoint] = None


class MCPEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[MCPEndpoint] = Field(default_factory=list)


class MCPConnectRequest(BaseModel):
    """Request MCP OAuth scope discovery or authorization.
    `scopes` present (an empty list is a legal "no scopes") is the begin step."""

    scopes: Optional[List[str]] = None

    @field_validator("scopes")
    @classmethod
    def scopes_must_be_distinct_non_blank(cls, scopes: Optional[List[str]]):
        """The dashboard sends discovered scope identifiers verbatim. Rejecting
        duplicates and whitespace-only values keeps the signed OAuth state stable
        and makes a reconnect/step-up request unambiguous without inventing an
        OAuth-specific scope grammar here."""
        if scopes is None:
            return scopes
        if any(not scope or scope != scope.strip() for scope in scopes):
            raise ValueError("scopes must be non-blank identifiers")
        if len(set(scopes)) != len(scopes):
            raise ValueError("scopes must not contain duplicates")
        return scopes


class MCPConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


class MCPEndpointProbeRequest(BaseModel):
    """Inspect a server URL before an endpoint exists.

    `url` is the only field, and deliberately: the probe routes a request and reports what
    came back. It takes no name (nothing is being labelled), no slug or id (nothing is
    being identified), and no credential — there is no endpoint to carry one, and a
    credential must never be sent to an origin nobody has chosen yet.
    """

    url: str


class MCPEndpointProbeResponse(BaseModel):
    count: int = 0
    probe: Optional[MCPServerProbeResult] = None


class MCPAgentaToolDescriptor(BaseModel):
    """One callback tool selected by the agent service for a single run."""

    name: str = Field(min_length=1, max_length=128)
    call_ref: str = Field(min_length=1, max_length=512)
    description: Optional[str] = Field(default=None, max_length=4096)
    input_schema: Dict[str, Any] = Field(default_factory=dict)


class MCPAgentaCredentialRequest(BaseModel):
    tools: List[MCPAgentaToolDescriptor] = Field(default_factory=list, max_length=128)


class MCPAgentaCredentialResponse(BaseModel):
    credentials: str
