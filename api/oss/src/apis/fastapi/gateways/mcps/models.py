"""MCP gateway management wire models (entities.md §6).

The house triple, matching `triggers/models.py`, plus the grant and connect shapes.

Grants get no create or edit request by design: a grant comes into being because a
consent flow completed, never because someone POSTed a grant document (§6). Do not add
`McpGrantCreateRequest` / `McpGrantEditRequest`.
"""

from typing import List, Optional

from pydantic import BaseModel, Field

from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointEdit,
    McpEndpointQuery,
    McpGrant,
    McpGrantQuery,
)
from oss.src.core.shared.dtos import Windowing


class McpEndpointCreateRequest(BaseModel):
    endpoint: McpEndpointCreate


class McpEndpointEditRequest(BaseModel):
    endpoint: McpEndpointEdit


class McpEndpointQueryRequest(BaseModel):
    endpoint: Optional[McpEndpointQuery] = None
    windowing: Optional[Windowing] = None


class McpEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[McpEndpoint] = None


class McpEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[McpEndpoint] = Field(default_factory=list)


class McpGrantQueryRequest(BaseModel):
    grant: Optional[McpGrantQuery] = None
    windowing: Optional[Windowing] = None


class McpGrantResponse(BaseModel):
    count: int = 0
    grant: Optional[McpGrant] = None


class McpGrantsResponse(BaseModel):
    count: int = 0
    grants: List[McpGrant] = Field(default_factory=list)


class McpConnectRequest(BaseModel):
    """Begin the consent flow on one endpoint (WP18). Scopes are SELECTED, not
    inherited from everything the server advertises (D17). Declared here for the
    wire shape; the route is wired by WP18, not this package."""

    scopes: List[str] = Field(default_factory=list)


class McpConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
