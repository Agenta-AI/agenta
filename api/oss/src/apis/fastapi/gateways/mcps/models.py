"""MCP gateway management wire models (entities.md §6).

The house triple, matching `triggers/models.py`, plus the connect shapes.

"""

from typing import List, Optional

from pydantic import BaseModel, Field

from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
)
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
    """Begin the consent flow on one endpoint (WP18). Scopes are SELECTED, not
    inherited from everything the server advertises (D17). Declared here for the
    wire shape; the route is wired by WP18, not this package."""

    scopes: List[str] = Field(default_factory=list)


class MCPConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
