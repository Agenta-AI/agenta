"""The MCP plane's DTOs (entities.md §4.4)."""

from enum import Enum
from typing import Dict, List, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateways.dtos import (
    GatewayAuthScheme,
    GatewayEndpointConfig,
    GatewayEndpointNamespace,
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


# The providers inside the `builtin` namespace (D30). Agenta is one supplier among
# them, not a namespace of its own.
AGENTA_PROVIDER = "agenta"
COMPOSIO_PROVIDER = "composio"


class McpToolPolicyMode(str, Enum):
    ALL = "all"
    INCLUDE = "include"


class McpToolPolicy(BaseModel):
    """Field-for-field mirror of the runner wire's McpToolPolicy
    (services/runner/src/protocol.ts), so the same document means the same
    thing on both sides of the gateway."""

    mode: McpToolPolicyMode = McpToolPolicyMode.ALL
    names: Optional[List[str]] = None  # required by the service when mode is INCLUDE


class McpEndpointConfig(GatewayEndpointConfig):
    """Nothing beyond the shared pair yet; the subclass exists so a first
    MCP-only knob is a DTO change, symmetric with the LLM side."""


class McpOAuthData(BaseModel):
    """Discovered authorization facts, cached on the row. Written by the OAuth
    checkpoint (WP17); absent until then. Not secret material — discovery
    metadata only (D3 holds: tokens live in the vault)."""

    resource: Optional[str] = None
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


class McpEndpointData(BaseModel):
    url: str
    headers: Optional[Dict[str, str]] = None  # non-secret routing headers only
    tool_policy: McpToolPolicy = Field(default_factory=McpToolPolicy)
    config: McpEndpointConfig = Field(default_factory=McpEndpointConfig)
    oauth: Optional[McpOAuthData] = None


class McpEndpointFlags(BaseModel):
    is_active: bool = True


class McpEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: GatewayAuthScheme
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
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)
    status: Optional[Status] = None


class McpEndpointCreate(Slug, Header, Metadata):
    auth_mode: GatewayAuthScheme
    secret_id: Optional[UUID] = None
    #
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)


class McpEndpointEdit(Identifier, Header, Metadata):
    auth_mode: (
        GatewayAuthScheme  # editable: none -> oauth; service revalidates secret_id
    )
    secret_id: Optional[UUID] = None
    #
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)


class McpEndpointQuery(BaseModel):
    auth_mode: Optional[GatewayAuthScheme] = None
    slug: Optional[str] = None


# --- grants ------------------------------------------------------------------ #


class McpGrantFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True  # server-set; flipped False by a failed refresh (§2.6)


class McpGrant(Identifier, Lifecycle):
    endpoint_id: UUID
    user_id: Optional[UUID] = None  # None: project-owned (§2.5)
    secret_id: UUID
    #
    flags: McpGrantFlags = Field(default_factory=McpGrantFlags)
    status: Optional[Status] = None


class McpGrantCreate(BaseModel):
    """Service-authored only: the OAuth flow writes the vault secret first, then
    this. No wire model wraps it (§6)."""

    endpoint_id: UUID
    user_id: Optional[UUID] = None
    secret_id: UUID
    #
    flags: McpGrantFlags = Field(default_factory=McpGrantFlags)


class McpGrantQuery(BaseModel):
    endpoint_id: Optional[UUID] = None
    user_id: Optional[UUID] = None


class McpCallContext(BaseModel):
    """What routing reads from the protocol's method and target headers — the
    body is never parsed for routing (`mcp.md`, header-based routing). The
    exact header names are pinned against the 2026-07-28 revision at
    implementation time, in apis/fastapi/gateways/mcps/utils.py."""

    method: str
    target: Optional[str] = None


class McpResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    config: McpEndpointConfig = Field(default_factory=McpEndpointConfig)


# --- the two secret mechanisms, made legible (D27) ------------------------ #


class McpDirectAuth(BaseModel):
    """agenta + custom: the secret is ours to present — an oauth_grant
    resolved from the vault (§7.2), or nothing for a NONE-scheme target."""

    secret: Optional[ResolvedSecret] = None


class McpBrokeredAuth(BaseModel):
    """builtin: the integrations domain brokered the authorization and holds the
    secret upstream; what we carry is its connection row. `Connection` is
    that domain's own DTO (core/gateway/connections/dtos.py), imported by
    reference (§1) — no copy, no subclass."""

    connection: Connection


McpRelayAuth = Union[McpDirectAuth, McpBrokeredAuth]
