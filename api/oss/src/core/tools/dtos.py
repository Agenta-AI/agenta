from enum import Enum
from typing import Any, Dict, List, Optional, Union

from agenta.sdk.agents.tools import BuiltinToolConfig, GatewayToolConfig
from agenta.sdk.models.workflows import JsonSchemas
from pydantic import BaseModel, Field

from oss.src.core.gateway.catalog.dtos import (
    CatalogIntegration,
    CatalogProvider,
)
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionCreateData,
    ConnectionStatus,
)
from oss.src.core.shared.dtos import (
    Identifier,
    Json,
    Status,
)

# ---------------------------------------------------------------------------
# Tool Enums
# ---------------------------------------------------------------------------


class ToolProviderKind(str, Enum):
    COMPOSIO = "composio"
    AGENTA = "agenta"


class ToolAuthScheme(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


# ---------------------------------------------------------------------------
# Tool Catalog
# ---------------------------------------------------------------------------

# Tags type for filtering tools by tag flags (e.g. {"important": true})
Tags = Optional[Dict[str, bool]]


class ToolCatalogAction(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    categories: List[str] = []
    logo: Optional[str] = None
    #
    # From the MCP behavioral hints: True (read-only), False (mutating), None (unknown).
    read_only: Optional[bool] = None


class ToolCatalogActionDetails(ToolCatalogAction):
    schemas: Optional[JsonSchemas] = None
    scopes: Optional[List[str]] = None


# Providers + integrations are SHARED across tools and triggers — defined once
# in gateway/catalog and inherited here so the tool-specific "details" leaves
# (nested actions) can extend them without duplicating the base shape.
class ToolCatalogIntegration(CatalogIntegration):
    auth_schemes: Optional[List[ToolAuthScheme]] = None


class ToolCatalogIntegrationDetails(ToolCatalogIntegration):
    actions: Optional[List[ToolCatalogAction]] = None


class ToolCatalogProvider(CatalogProvider):
    key: ToolProviderKind


class ToolCatalogProviderDetails(ToolCatalogProvider):
    integrations: Optional[List[ToolCatalogIntegration]] = None


class ToolCatalogIntegrationsPage(BaseModel):
    """A cursor-paginated page of tool integrations."""

    integrations: List[ToolCatalogIntegration] = []
    next_cursor: Optional[str] = None
    total: int = 0


class ToolCatalogActionsPage(BaseModel):
    """A cursor-paginated page of tool actions."""

    actions: List[ToolCatalogAction] = []
    next_cursor: Optional[str] = None
    total: int = 0


# ---------------------------------------------------------------------------
# Tool Connections — shared `gateway_connections` rows, inherited here so the
# tools router/models never reference the generic gateway DTOs directly.
# ---------------------------------------------------------------------------


class ToolConnectionStatus(ConnectionStatus):
    pass


class ToolConnectionCreateData(ConnectionCreateData):
    auth_scheme: Optional[ToolAuthScheme] = None


class ToolConnection(Connection):
    provider_key: ToolProviderKind
    status: Optional[ToolConnectionStatus] = None


class ToolConnectionCreate(ConnectionCreate):
    provider_key: ToolProviderKind
    data: Optional[Union[ToolConnectionCreateData, Json]] = None


# ---------------------------------------------------------------------------
# Tool Calls
# ---------------------------------------------------------------------------


class ToolCallFunction(BaseModel):
    """Mirrors OpenAI function call: {name, arguments}."""

    name: str  # ~ tool.slug
    arguments: Any  # JSON string (as returned by LLM) or parsed dict


class ToolCallData(BaseModel):
    """OpenAI tool_calls array item — passed verbatim from the LLM."""

    id: str  # LLM call ID (e.g. "call_zEoV...")
    type: str = "function"
    function: ToolCallFunction


class ToolCall(BaseModel):
    """Request envelope — wraps the raw OpenAI tool call."""

    data: ToolCallData


class ToolResultData(BaseModel):
    """OpenAI tool message — passed verbatim back to the LLM."""

    role: str = "tool"
    tool_call_id: str  # Echoed from ToolCallData.id
    content: str  # Execution result serialised as a JSON string


class ToolResult(Identifier):
    """Response envelope with Agenta identity, status, and the OpenAI tool message."""

    status: Optional[Status] = None
    data: Optional[ToolResultData] = None


# ---------------------------------------------------------------------------
# Tool Execution (adapter-level DTOs)
# ---------------------------------------------------------------------------


class ToolExecutionRequest(BaseModel):
    """Input DTO for executing a tool action via a provider adapter."""

    integration_key: str
    action_key: str
    provider_connection_id: Optional[str] = None  # absent for no-auth toolkits
    user_id: Optional[str] = None
    arguments: Dict[str, Any] = {}


class ToolExecutionResponse(BaseModel):
    """Output DTO from executing a tool action via a provider adapter."""

    data: Optional[Json] = None
    error: Optional[str] = None
    successful: bool = False


# ---------------------------------------------------------------------------
# Tool references + resolution
# ---------------------------------------------------------------------------

# A provider-agnostic list of tool references lives under an agent revision's
# ``parameters["tools"]``. Each entry is a discriminated union on ``type``: config
# holds references and display metadata only, never secrets. The backend resolves
# them into model-ready specs at invoke time (see ToolsService.resolve_tools).


BuiltinTool = BuiltinToolConfig
ComposioTool = GatewayToolConfig
ToolReference = Union[BuiltinToolConfig, GatewayToolConfig]


class ResolvedTool(BaseModel):
    """A runnable reference resolved into a model-ready tool spec.

    ``call_ref`` is the ``tools.{provider}.{integration}.{action}.{connection}`` slug
    the execution bridge sends back to ``POST /tools/call``.
    """

    name: str
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    call_ref: str
    read_only: Optional[bool] = None


class ToolsResolution(BaseModel):
    """Outcome of resolving a ``tools`` list.

    ``builtins`` pass straight into Pi's ``tools: string[]``; ``custom`` become Pi
    ``customTools`` whose ``execute`` routes through ``/tools/call``.
    """

    builtins: List[str] = Field(default_factory=list)
    custom: List[ResolvedTool] = Field(default_factory=list)
