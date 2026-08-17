"""The MCP plane's DTOs (entities.md §4.4)."""

from typing import Dict, List, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateways.dtos import (
    GatewayAuthScheme,
    GatewayEndpointFilter,
    GatewayEndpointNamespace,
    GatewayEndpointRoute,
    GatewayEndpointSettings,
)
from oss.src.core.gateways.policy.dtos import ResolvedSecret
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
    Status,
)


# The MCP plane's name for the shared scheme enum. Same members, same storage — the
# plane reads its own vocabulary rather than reaching for the domain root's.
MCPAuthScheme = GatewayAuthScheme


# The providers inside the `builtin` namespace (D30). Agenta is one supplier among
# them, not a namespace of its own.
AGENTA_PROVIDER = "agenta"
COMPOSIO_PROVIDER = "composio"


class MCPEndpointRoute(GatewayEndpointRoute):
    """Nothing beyond the shared pair: an MCP server is one URL (D16) and the
    protocol POSTs to it directly — unlike the LLM planes's `base_url`, no path is
    appended. The subclass exists so a first MCP-only route field is a DTO change."""


# The MCP plane's name for the shared filter. Same shape, same storage.
MCPToolFilter = GatewayEndpointFilter


class MCPEndpointSettings(GatewayEndpointSettings):
    """Nothing beyond the shared field yet; the subclass exists so a first
    MCP-only knob is a DTO change, symmetric with the LLM side."""


class MCPOAuthData(BaseModel):
    """Discovered authorization facts, cached on the row. Written by the OAuth
    checkpoint (WP17); absent until then. Not secret material — discovery
    metadata only (D3 holds: tokens live in the vault)."""

    resource: Optional[str] = None
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


class MCPEndpointData(BaseModel):
    route: MCPEndpointRoute = Field(default_factory=MCPEndpointRoute)
    tools: MCPToolFilter = Field(default_factory=MCPToolFilter)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
    oauth: Optional[MCPOAuthData] = None


class MCPEndpointFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True  # server-set: a failed refresh flips it (§2.6, D18)


class MCPEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: MCPAuthScheme
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    connection_id: Optional[UUID] = (
        None  # BUILTIN only: the brokered gateway_connections row (§1)
    )
    provider_key: Optional[str] = None
    integration_key: Optional[str] = (
        None  # BUILTIN only, with slug: the three URL segments (§2.3)
    )
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)
    status: Optional[Status] = None


class MCPEndpointCreate(Slug, Header, Metadata):
    auth_mode: MCPAuthScheme
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)


class MCPEndpointEdit(Identifier, Header, Metadata):
    auth_mode: MCPAuthScheme  # editable: none -> oauth; service revalidates secret_id
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)


class MCPEndpointQuery(BaseModel):
    auth_mode: Optional[MCPAuthScheme] = None
    slug: Optional[str] = None


class MCPCallContext(BaseModel):
    """What routing reads from the protocol's method and target headers — the
    body is never parsed for routing (`mcp.md`, header-based routing). The
    exact header names are pinned against the 2026-07-28 revision at
    implementation time, in apis/fastapi/gateways/mcps/utils.py."""

    method: str
    target: Optional[str] = None


class MCPResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)


# --- the two secret mechanisms, made legible (D27) ------------------------ #


class MCPDirectAuth(BaseModel):
    """agenta + custom: the secret is ours to present — an oauth_grant
    resolved from the vault (§7.2), or nothing for a NONE-scheme target."""

    secret: Optional[ResolvedSecret] = None


class MCPBrokeredAuth(BaseModel):
    """builtin: the integrations domain brokered the authorization and holds the
    secret upstream; what we carry is its connection row. `Connection` is
    that domain's own DTO (core/gateway/connections/dtos.py), imported by
    reference (§1) — no copy, no subclass."""

    connection: Connection


MCPRelayAuth = Union[MCPDirectAuth, MCPBrokeredAuth]
