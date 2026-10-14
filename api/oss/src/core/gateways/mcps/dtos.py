"""MCP gateway DTOs."""

from typing import Annotated, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

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


MCPAuthScheme = GatewayAuthScheme


# Builtin MCP providers.
AGENTA_PROVIDER = "agenta"
COMPOSIO_PROVIDER = "composio"
MOCK_PROVIDER = "mock"
# Paid actions on provider accounts Agenta holds (`core/managed_tools`).
MANAGED_PROVIDER = "managed"


class MCPCredentialBinding(BaseModel):
    """Where an API-key endpoint's credential goes when the relay sends it.

    Configuration only: the value stays in the vault behind the endpoint's `secret_id`, so
    this is as readable as `base_url` is. `kind` and `name` match the SDK's
    `HeaderCredentialBinding`. A `header` binding sends `<name>: <prefix> <value>`, or
    `<name>: <value>` with no prefix; a `query` binding adds `<name>=<value>` to the
    upstream URL at request time, so the stored URL never holds the value. The prefix is
    the scheme word (`Bearer`, `Basic`) a server expects in front of the value, because a
    raw key under `Authorization` is refused by every server that names a scheme.
    """

    kind: Literal["header", "query"] = "header"
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    prefix: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    ] = None


class MCPEndpointRoute(GatewayEndpointRoute):
    """Route for one MCP server.

    `credential_binding` says how an API-key endpoint's credential travels. None sends
    `Authorization: Bearer <key>`, and an OAuth endpoint ignores it because a grant
    travels under the scheme its authorization server issued it with.
    """

    credential_binding: Optional[MCPCredentialBinding] = None


# The MCP plane's name for the shared filter. Same shape, same storage.
MCPToolFilter = GatewayEndpointFilter


class MCPEndpointSettings(GatewayEndpointSettings):
    """MCP endpoint settings."""


class MCPOAuthData(BaseModel):
    """Non-secret OAuth discovery metadata."""

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
    is_valid: bool = True


class MCPEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: MCPAuthScheme
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    connection_id: Optional[UUID] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
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
    """MCP method and target extracted from the JSON-RPC request."""

    method: str
    target: Optional[str] = None


class MCPResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
    # Carried from the endpoint's `MCPEndpointRoute`. Never the value: the adapter reads
    # that from the resolved secret it is handed alongside this route.
    credential_binding: Optional[MCPCredentialBinding] = None
    # Standard Composio sessions bind external accounts to this project scope.
    project_id: Optional[UUID] = None


class MCPDirectAuth(BaseModel):
    """Credentials resolved directly by the gateway."""

    secret: Optional[ResolvedSecret] = None


class MCPBrokeredAuth(BaseModel):
    """A brokered integration connection."""

    connection: Connection


MCPRelayAuth = Union[MCPDirectAuth, MCPBrokeredAuth]
