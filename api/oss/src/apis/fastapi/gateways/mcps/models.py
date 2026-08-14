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
    """Drives the two-step consent flow (specs-wp18.md). `scopes: None` (absent)
    is the discover step — nothing chosen yet, the response carries the checklist.
    `scopes` present (an empty list is a legal "no scopes") is the begin step."""

    scopes: Optional[List[str]] = None


class MCPConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)
