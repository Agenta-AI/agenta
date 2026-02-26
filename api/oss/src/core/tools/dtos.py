from enum import Enum
from typing import Any, Dict, List, Optional

from agenta.sdk.models.workflows import JsonSchemas
from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
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


class ToolCatalogActionDetails(ToolCatalogAction):
    schemas: Optional[JsonSchemas] = None
    scopes: Optional[List[str]] = None


class ToolCatalogIntegration(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    categories: List[str] = []
    logo: Optional[str] = None
    url: Optional[str] = None
    #
    actions_count: Optional[int] = None
    #
    auth_schemes: Optional[List[ToolAuthScheme]] = None


class ToolCatalogIntegrationDetails(ToolCatalogIntegration):
    actions: Optional[List[ToolCatalogAction]] = None


class ToolCatalogProvider(BaseModel):
    key: ToolProviderKind
    #
    name: str
    description: Optional[str] = None
    #
    integrations_count: Optional[int] = None
    #


class ToolCatalogProviderDetails(ToolCatalogProvider):
    integrations: Optional[List[ToolCatalogIntegration]] = None


# ---------------------------------------------------------------------------
# Tool Connections
# ---------------------------------------------------------------------------


class ToolConnectionStatus(BaseModel):
    redirect_url: Optional[str] = None


class ToolConnectionCreateData(BaseModel):
    callback_url: Optional[str] = None
    #
    auth_scheme: Optional[ToolAuthScheme] = None


class ToolConnection(
    Identifier,
    Slug,
    Header,
    Lifecycle,
    Metadata,
):
    provider_key: ToolProviderKind
    integration_key: str
    #
    data: Optional[Json] = None
    #
    status: Optional[ToolConnectionStatus] = None

    @property
    def provider_connection_id(self) -> Optional[str]:
        """Get provider-specific connection ID from data."""
        if self.data and isinstance(self.data, dict):
            # For Composio, it's stored as "connected_account_id"
            return self.data.get("connected_account_id") or self.data.get(
                "provider_connection_id"
            )
        return None

    @property
    def is_active(self) -> bool:
        """Check if connection is active (not deleted)."""
        if self.flags and isinstance(self.flags, dict):
            return self.flags.get("is_active", False)
        return False

    @property
    def is_valid(self) -> bool:
        """Check if connection is valid (authenticated)."""
        if self.flags and isinstance(self.flags, dict):
            return self.flags.get("is_valid", False)
        return False


class ToolConnectionCreate(
    Slug,
    Header,
    Metadata,
):
    provider_key: ToolProviderKind
    integration_key: str
    #
    data: Optional[ToolConnectionCreateData] = None


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
# Tool Connection (adapter-level DTOs)
# ---------------------------------------------------------------------------


class ToolConnectionRequest(BaseModel):
    """Input DTO for initiating a provider connection via a gateway adapter."""

    user_id: str
    integration_key: str
    auth_scheme: Optional[str] = None
    callback_url: Optional[str] = None


class ToolConnectionResponse(BaseModel):
    """Output DTO from ToolsGatewayInterface.initiate_connection.

    The adapter builds ``connection_data`` with provider-specific fields so the
    service never needs to know which provider it is talking to.
    """

    provider_connection_id: str
    redirect_url: Optional[str] = None
    connection_data: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Tool Execution (adapter-level DTOs)
# ---------------------------------------------------------------------------


class ToolExecutionRequest(BaseModel):
    """Input DTO for executing a tool action via a provider adapter."""

    integration_key: str
    action_key: str
    provider_connection_id: str
    user_id: Optional[str] = None
    arguments: Dict[str, Any] = {}


class ToolExecutionResponse(BaseModel):
    """Output DTO from executing a tool action via a provider adapter."""

    data: Optional[Json] = None
    error: Optional[str] = None
    successful: bool = False
