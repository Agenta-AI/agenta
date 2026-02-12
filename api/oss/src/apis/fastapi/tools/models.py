from typing import Any, Dict, List, Literal, Optional
from datetime import datetime

from pydantic import BaseModel

from oss.src.core.shared.dtos import Tags, Windowing


# ---------------------------------------------------------------------------
# Catalog browse response models
# ---------------------------------------------------------------------------


class ProviderItem(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    integrations_count: int = 0
    enabled: bool = True


class ProvidersResponse(BaseModel):
    count: int = 0
    items: List[ProviderItem] = []


class IntegrationItem(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    logo: Optional[str] = None
    auth_schemes: List[str] = []
    actions_count: int = 0
    categories: List[str] = []
    no_auth: bool = False
    connections_count: int = 0


class IntegrationsResponse(BaseModel):
    count: int = 0
    items: List[IntegrationItem] = []


class ConnectionItem(BaseModel):
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    is_valid: bool = False
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class IntegrationDetailResponse(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    logo: Optional[str] = None
    auth_schemes: List[str] = []
    actions_count: int = 0
    categories: List[str] = []
    no_auth: bool = False
    connections: List[ConnectionItem] = []


class ActionItem(BaseModel):
    key: str
    slug: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None


class ActionsListResponse(BaseModel):
    count: int = 0
    items: List[ActionItem] = []


class ActionDetailResponse(BaseModel):
    key: str
    slug: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Catalog query models
# ---------------------------------------------------------------------------


class ActionQueryBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    tags: Optional[Tags] = None


class ActionQueryRequest(BaseModel):
    action: Optional[ActionQueryBody] = None
    windowing: Optional[Windowing] = None


class CatalogActionResult(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    provider_key: str
    integration_key: str
    integration_name: str
    integration_logo: Optional[str] = None


class ActionsResponse(BaseModel):
    count: int = 0
    actions: List[CatalogActionResult] = []


# ---------------------------------------------------------------------------
# Tool query models
# ---------------------------------------------------------------------------


class ToolQueryFlagsBody(BaseModel):
    is_connected: Optional[bool] = None


class ToolQueryBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    tags: Optional[Tags] = None
    flags: Optional[ToolQueryFlagsBody] = None


class ToolQueryRequest(BaseModel):
    tool: Optional[ToolQueryBody] = None
    include_connections: Optional[bool] = True
    windowing: Optional[Windowing] = None


class ConnectionSummary(BaseModel):
    slug: str
    name: Optional[str] = None
    is_active: bool
    is_valid: bool


class ToolResult(BaseModel):
    slug: str
    action_key: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    provider_key: str
    integration_key: str
    integration_name: str
    integration_logo: Optional[str] = None
    connection: Optional[ConnectionSummary] = None


class ToolsResponse(BaseModel):
    count: int = 0
    tools: List[ToolResult] = []


# ---------------------------------------------------------------------------
# Connection CRUD models
# ---------------------------------------------------------------------------


class ConnectionCreateRequest(BaseModel):
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    mode: Literal["oauth", "api_key"]
    callback_url: Optional[str] = None
    credentials: Optional[Dict[str, str]] = None


class ConnectionResponse(BaseModel):
    connection: ConnectionItem
    redirect_url: Optional[str] = None


class ConnectionsListResponse(BaseModel):
    count: int = 0
    connections: List[ConnectionItem] = []


# ---------------------------------------------------------------------------
# Slug-based operation models
# ---------------------------------------------------------------------------


class ConnectRequest(BaseModel):
    slug: str  # tools.{provider}.{integration}
    connection_slug: str
    name: Optional[str] = None
    mode: Literal["oauth", "api_key"] = "oauth"
    callback_url: Optional[str] = None
    credentials: Optional[Dict[str, str]] = None


class RefreshRequest(BaseModel):
    slug: str  # tools.{provider}.{integration}.{connection_slug}
    force: bool = False


class RefreshResponse(BaseModel):
    connection: ConnectionItem
    redirect_url: Optional[str] = None
